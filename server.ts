import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // API Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Gemini TTS Endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = "Fenrir" } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Văn bản không được để trống" });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Chưa cấu hình GEMINI_API_KEY trên server." });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // We instruct the model to perform high quality speech synthesis in Vietnamese
      const prompt = `Hãy đọc to, rõ ràng, truyền cảm và tự nhiên nội dung tiếng Việt sau: "${text}"`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(500).json({ error: "Không nhận được phản hồi âm thanh từ mô hình Gemini TTS. Hãy thử lại." });
      }

      // Convert raw 24kHz 16-bit Mono PCM to full WAV
      const pcmBuffer = Buffer.from(base64Audio, "base64");
      const wavBuffer = addWavHeader(pcmBuffer, 24000);

      return res.json({
        success: true,
        audioBase64: wavBuffer.toString("base64"),
      });
    } catch (error: any) {
      console.error("TTS API Error:", error);
      return res.status(500).json({ error: error.message || "Lỗi xử lý chuyển đổi Text-to-Speech" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

function addWavHeader(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const chunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

startServer();
