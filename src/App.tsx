import React, { useState, useEffect, useRef } from "react";
import { 
  auth, 
  db, 
  initAuth 
} from "./firebase";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp 
} from "firebase/firestore";
import { 
  Mic, 
  Play, 
  Pause, 
  Square, 
  Volume2, 
  RotateCcw, 
  Download, 
  History, 
  Trash2, 
  Sparkles, 
  Sliders, 
  VolumeX, 
  Check, 
  CloudLightning,
  CloudLightning as CloudIcon,
  HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Prebuilt voices details for Gemini 3.1 TTS
interface VoiceOption {
  id: string;
  name: string;
  gender: "nam" | "nữ";
  description: string;
  badge: string;
}

const VOICES: VoiceOption[] = [
  { id: "Fenrir", name: "Fenrir", gender: "nữ", description: "Giọng nữ trầm ấm, chín chắn & truyền cảm", badge: "Nữ trầm ấm (Mặc định)" },
  { id: "Charon", name: "Charon", gender: "nam", description: "Giọng nam trầm, dõng dạc & vững vàng", badge: "Giọng nam dõng dạc" },
  { id: "Puck", name: "Puck", gender: "nam", description: "Giọng nam trẻ trung, nhanh nhẹn & thân thiện", badge: "Giọng nam năng động" },
  { id: "Kore", name: "Kore", gender: "nữ", description: "Giọng nữ ấm áp, dịu dàng & dễ mến", badge: "Giọng nữ ấm áp" },
  { id: "Zephyr", name: "Zephyr", gender: "nữ", description: "Giọng nữ nhẹ nhàng, êm dịu & bay bổng", badge: "Giọng nữ thư thái" },
];

const EXAMPLES = [
  {
    label: "Lời chào mừng",
    text: "Chào mừng bạn đến với Studio Giọng Nói Trầm Ấm. Chúc bạn một ngày làm việc tràn đầy năng lượng và niềm vui."
  },
  {
    label: "Dự báo thời tiết",
    text: "Hôm nay, thời tiết Hà Nội mát mẻ, trời nhiều mây và có thể có mưa rào nhẹ vào buổi chiều tối. Hãy nhớ mang theo ô khi ra ngoài."
  },
  {
    label: "Trích dẫn truyền cảm hứng",
    text: "Hãy nhắm mắt lại, hít một hơi thật sâu và cảm nhận sự yên bình. Mọi nỗ lực của bạn ngày hôm nay đều vô cùng đáng trân trọng."
  }
];

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("Fenrir");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio Processing and Playback states
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);

  // Sound adjusting sliders
  const [speed, setSpeed] = useState(1.0); // 0.5 to 2.0
  const [pitch, setPitch] = useState(0); // -1200 to +1200 cents
  const [bassBoost, setBassBoost] = useState(true); // Lowpass / Bass boost EQ for "trầm ấm" feel

  // History state
  const [history, setHistory] = useState<any[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Audio Refs for Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);

  // Visualizer Canvas Ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Refs for tracking playback time
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const timerRef = useRef<any>(null);

  // Initialize Anonymous Auth and fetch Cloud History
  useEffect(() => {
    async function setupSession() {
      setIsAuthLoading(true);
      const currentUser = await initAuth();
      setUser(currentUser);
      setIsAuthLoading(false);
    }
    setupSession();
  }, []);

  // Listen to cloud history once user is loaded
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "tracks"),
      where("userId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        };
      });
      // Sort manually by date desc to avoid needing Firestore composite indexes
      list.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
      setHistory(list);
    }, (err) => {
      console.error("Firestore history load failed:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // Sync isPlaying to Ref for visualizer loop
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) {
      startVisualizer();
      startTimer();
    } else {
      stopTimer();
    }
  }, [isPlaying]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Dynamically update playback parameters (speed & detune & filter) when sliders are changed
  useEffect(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.playbackRate.value = speed;
      } catch (e) {}
    }
  }, [speed]);

  useEffect(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.detune.value = pitch;
      } catch (e) {}
    }
  }, [pitch]);

  useEffect(() => {
    if (filterNodeRef.current) {
      try {
        filterNodeRef.current.gain.value = bassBoost ? 10 : 0; // 10dB bass boost
      } catch (e) {}
    }
  }, [bassBoost]);

  useEffect(() => {
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.gain.value = isMuted ? 0 : volume;
      } catch (e) {}
    }
  }, [volume, isMuted]);

  // Helper: Convert Base64 to ArrayBuffer
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  // Setup/Get AudioContext
  const getAudioContext = (): AudioContext => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  // Decode and load WAV audio base64
  const loadAudioBuffer = async (base64Data: string) => {
    try {
      stopAudio();
      const ctx = getAudioContext();
      const arrayBuffer = base64ToArrayBuffer(base64Data);
      
      // Decode audio data
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      audioBufferRef.current = decodedBuffer;
      setDuration(decodedBuffer.duration / speed); // Approximate duration factoring speed
      setCurrentTime(0);
      pausedTimeRef.current = 0;
    } catch (err: any) {
      console.error("Audio decoding failed:", err);
      setError("Không thể giải mã dữ liệu âm thanh. Hãy thử lại.");
    }
  };

  // Start visualizer animation loop
  const startVisualizer = () => {
    if (!canvasRef.current || !analyserNodeRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserNodeRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }

    const draw = () => {
      if (!isPlayingRef.current) {
        // Draw centered flat line on stop
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = "rgba(229, 161, 88, 0.4)";
        ctx.lineWidth = 3;
        ctx.stroke();
        return;
      }

      animationFrameIdRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      // Elegant trailing background wash
      ctx.fillStyle = "rgb(22, 24, 26)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 3;
      // Beautiful glowing gradient line
      const lineGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      lineGradient.addColorStop(0, "#E5A158");
      lineGradient.addColorStop(0.5, "#f59e0b");
      lineGradient.addColorStop(1, "#d97706");
      ctx.strokeStyle = lineGradient;

      ctx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      // Draw mirrored bars behind for volumetric depth
      analyser.getByteFrequencyData(dataArray);
      const barWidth = (canvas.width / bufferLength) * 2;
      let barX = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 4;
        ctx.fillStyle = `rgba(229, 161, 88, ${dataArray[i] / 512})`;
        ctx.fillRect(barX, canvas.height / 2 - barHeight / 2, barWidth - 1, barHeight);
        barX += barWidth;
      }
    };

    draw();
  };

  // Timer loop to track playback position
  const startTimer = () => {
    stopTimer();
    const interval = 100; // Check 10 times a second
    timerRef.current = setInterval(() => {
      if (!audioContextRef.current || !isPlayingRef.current || !audioBufferRef.current) return;
      
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      const progress = elapsed * speed; // Account for speed adjustment

      if (progress >= audioBufferRef.current.duration) {
        if (isLooping) {
          // Loop back to start
          playAudio(0);
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
          pausedTimeRef.current = 0;
          stopTimer();
        }
      } else {
        setCurrentTime(progress);
      }
    }, interval);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Play audio from a specific position in seconds
  const playAudio = async (fromTime: number = pausedTimeRef.current) => {
    if (!audioBufferRef.current) return;
    try {
      const ctx = getAudioContext();
      
      // Stop any current source node first
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch (e) {}
      }

      // Create new source node (nodes are one-time use)
      const source = ctx.createBufferSource();
      source.buffer = audioBufferRef.current;
      sourceNodeRef.current = source;

      // Create Bass Boost Low-shelf Filter Node
      const filter = ctx.createBiquadFilter();
      filter.type = "lowshelf";
      filter.frequency.value = 120; // Target frequencies below 120Hz for rich male bass
      filter.gain.value = bassBoost ? 10 : 0; // Boost by 10 decibels
      filterNodeRef.current = filter;

      // Create Gain Node for volume control
      const gainNode = ctx.createGain();
      gainNode.gain.value = isMuted ? 0 : volume;
      gainNodeRef.current = gainNode;

      // Create Analyser Node for dynamic waveform drawing
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserNodeRef.current = analyser;

      // Wire up the graph: Source -> Bass Boost Filter -> Volume Gain -> Wave Analyser -> Speaker Destination
      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(ctx.destination);

      // Set playback parameters
      source.playbackRate.value = speed;
      source.detune.value = pitch;

      // Compute context play offset accounting for custom speed
      const sourceOffset = fromTime;
      
      // Start audio playing
      source.start(0, sourceOffset);
      
      // Compute absolute start coordinate in Context Time coordinates
      startTimeRef.current = ctx.currentTime - (fromTime / speed);
      
      setIsPlaying(true);
    } catch (err) {
      console.error("Playback failed:", err);
      setError("Không thể phát âm thanh. Vui lòng thử lại.");
    }
  };

  // Pause audio and remember progress
  const pauseAudio = () => {
    if (!isPlaying || !sourceNodeRef.current) return;
    try {
      sourceNodeRef.current.stop();
    } catch (e) {}
    
    if (audioContextRef.current) {
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      pausedTimeRef.current = elapsed * speed;
      setCurrentTime(pausedTimeRef.current);
    }
    setIsPlaying(false);
  };

  // Completely stop and reset playback position
  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {}
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    pausedTimeRef.current = 0;
  };

  // Seek audio directly to a target time
  const handleSeek = (time: number) => {
    if (!audioBufferRef.current) return;
    pausedTimeRef.current = Math.max(0, Math.min(time, audioBufferRef.current.duration));
    setCurrentTime(pausedTimeRef.current);
    
    if (isPlaying) {
      playAudio(pausedTimeRef.current);
    }
  };

  // Core service call to generate TTS voice via Gemini
  const generateVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("Vui lòng điền nội dung cần chuyển đổi.");
      return;
    }

    if (text.length > 3000) {
      setError("Văn bản quá dài. Vui lòng rút ngắn dưới 3000 ký tự để tối ưu chất lượng âm thanh.");
      return;
    }

    setLoading(true);
    setError(null);
    stopAudio();

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.trim(),
          voice: selectedVoice,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Không thể khởi tạo âm thanh.");
      }

      setAudioBase64(data.audioBase64);
      setActiveHistoryId(null);

      // Decodes and loads newly generated track
      await loadAudioBuffer(data.audioBase64);

      // Play instantly once decoded
      setTimeout(() => {
        playAudio(0);
      }, 100);

      // Save record to Cloud Database (Firestore) under user id
      if (user) {
        const trackId = `track_${Date.now()}`;
        const newTrack = {
          id: trackId,
          userId: user.uid,
          text: text.trim(),
          voice: selectedVoice,
          speed: speed,
          pitch: pitch,
          bassBoost: bassBoost,
          audioBase64: data.audioBase64,
          createdAt: serverTimestamp(),
        };
        try {
          await setDoc(doc(db, "tracks", trackId), newTrack);
        } catch (dbErr: any) {
          console.warn("Could not sync to cloud history (likely exceeded Firestore document size limits):", dbErr);
          // Display a friendly warning without failing the sound generation
          setError("Giọng nói đã tạo thành công! Bản ghi này quá lớn nên không thể đồng bộ lên đám mây, hãy tải trực tiếp về thiết bị.");
        }
      }
    } catch (err: any) {
      console.error("Generation error:", err);
      setError(err.message || "Lỗi kết nối máy chủ TTS. Vui lòng kiểm tra lại cấu hình hoặc thử lại.");
    } finally {
      setLoading(false);
    }
  };

  // Load a track from Cloud History
  const loadHistoryTrack = async (track: any) => {
    setError(null);
    stopAudio();
    setActiveHistoryId(track.id);
    setAudioBase64(track.audioBase64);
    setText(track.text);
    setSelectedVoice(track.voice);
    setSpeed(track.speed || 1.0);
    setPitch(track.pitch || 0);
    setBassBoost(track.bassBoost !== undefined ? track.bassBoost : true);

    await loadAudioBuffer(track.audioBase64);
    
    // Auto-play loaded track
    setTimeout(() => {
      playAudio(0);
    }, 150);
  };

  // Delete a track from Cloud History
  const deleteHistoryTrack = async (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, "tracks", trackId));
      if (activeHistoryId === trackId) {
        stopAudio();
        setAudioBase64(null);
        setActiveHistoryId(null);
      }
    } catch (err) {
      console.error("Failed to delete track:", err);
      setError("Không thể xóa bản ghi khỏi lưu trữ đám mây.");
    }
  };

  // Download raw WAV binary file
  const downloadWav = () => {
    if (!audioBase64) return;
    try {
      const arrayBuffer = base64ToArrayBuffer(audioBase64);
      const blob = new Blob([arrayBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Studio_GiongNoi_${selectedVoice}_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Tải tệp âm thanh thất bại.");
    }
  };

  // Clean Markdown formatting often found in ChatGPT responses for optimal speech synthesis
  const cleanMarkdownForTTS = (rawText: string): string => {
    // Replace markdown bold/italic
    let clean = rawText
      .replace(/\*\*\*(.*?)\*\*\*/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/___(.*?);___/g, "$1")
      .replace(/__(.*?);__/g, "$1")
      .replace(/_(.*?);_/g, "$1");
    
    // Clean headers
    clean = clean.replace(/^\s*#+\s+/gm, "");
    
    // Convert list bullet dashes to simple dots or clean them
    clean = clean.replace(/^\s*[-*+]\s+/gm, "• ");
    
    // Clean block code and inline backticks
    clean = clean.replace(/```[\s\S]*?```/g, "");
    clean = clean.replace(/`(.*?)`/g, "$1");
    
    return clean;
  };

  // Pre-fill prompt templates
  const applyTemplate = (val: string) => {
    if (val.length <= 3000) {
      setText(val);
      setError(null);
    }
  };

  // Seconds parser to MM:SS
  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div className="min-h-screen bg-[#0F1012] text-[#E0E0E0] font-sans antialiased pb-12 selection:bg-[#E5A158] selection:text-black">
      {/* Background soft ambient gold highlight */}
      <div className="absolute top-0 left-0 right-0 h-[400px] bg-gradient-to-b from-[#E5A158]/5 via-transparent to-transparent pointer-events-none" />

      {/* Main navigation / status banner */}
      <header className="h-16 border-b border-[#2D2F33] bg-[#16181A] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E5A158] rounded-lg flex items-center justify-center shadow-lg shadow-[#E5A158]/20">
              <Mic className="h-5 w-5 text-black" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                VOCALIS <span className="text-[#E5A158]">AI</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-xs text-[#A0A0A0]">
              {isAuthLoading ? (
                <div className="h-2 w-2 rounded-full bg-[#606060] animate-pulse" />
              ) : user ? (
                <>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span>Đã kết nối Cloud Sync</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                  <span>Chế độ Offline</span>
                </>
              )}
            </div>
            <div className="w-9 h-9 rounded-full bg-[#2D2F33] border border-[#3D3F43] flex items-center justify-center text-sm font-medium text-white">
              HA
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        {/* Sidebar Left: Cloud History (Col 3) */}
        <aside className="lg:col-span-3 lg:order-1 bg-[#121416] border border-[#2D2F33] rounded-xl p-5 flex flex-col h-[650px]">
          <div className="text-xs uppercase tracking-widest text-[#606060] font-bold mb-4 flex items-center justify-between border-b border-[#2D2F33] pb-3">
            <span>Dự án đám mây</span>
            <span className="text-[10px] bg-[#1E2023] px-2 py-0.5 rounded font-semibold text-[#A0A0A0] font-mono">
              {history.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-[#2D2F33]">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[#606060]">
                <div className="h-10 w-10 rounded-full border border-dashed border-[#2D2F33] flex items-center justify-center mb-3">
                  <History className="h-4 w-4 text-[#404040]" />
                </div>
                <p className="text-xs font-semibold text-[#808080]">Chưa có dự án nào</p>
                <p className="text-[10px] text-[#606060] mt-1 max-w-[180px] leading-relaxed">
                  Các văn bản và giọng đọc bạn tạo sẽ tự động đồng bộ trên đám mây tại đây.
                </p>
              </div>
            ) : (
              history.map((track) => {
                const isActive = activeHistoryId === track.id;
                const isMale = VOICES.find((v) => v.id === track.voice)?.gender === "nam";
                
                return (
                  <div
                    key={track.id}
                    onClick={() => loadHistoryTrack(track)}
                    className={`group p-3 rounded-lg border text-left cursor-pointer transition-all relative flex flex-col justify-between gap-2 ${
                      isActive
                        ? "bg-[#1E2023] border-[#E5A158]"
                        : "bg-transparent border-transparent hover:bg-[#1E2023] hover:border-[#2D2F33]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium truncate ${isActive ? "text-white" : "text-[#A0A0A0] group-hover:text-white"}`}>
                        {track.text}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => deleteHistoryTrack(e, track.id)}
                        className="text-[#606060] hover:text-rose-400 p-0.5 rounded transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Xóa bản ghi"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[#606060]">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1 rounded-sm text-[9px] font-semibold border ${
                          isMale ? "bg-cyan-950/40 border-cyan-900/30 text-cyan-400" : "bg-purple-950/40 border-purple-900/30 text-purple-400"
                        }`}>
                          {track.voice}
                        </span>
                        <span>
                          {track.speed}x • {track.pitch > 0 ? `+${track.pitch}` : track.pitch}c
                        </span>
                      </div>
                      <span className="font-mono text-[9px]">
                        {track.createdAt ? track.createdAt.toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"}) : "Vừa xong"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <button 
            type="button"
            onClick={() => {
              setText("");
              setActiveHistoryId(null);
              setAudioBase64(null);
              stopAudio();
            }}
            className="mt-4 w-full py-2 bg-transparent border border-dashed border-[#404040] text-[#A0A0A0] text-xs rounded-md hover:border-[#E5A158] hover:text-[#E5A158] transition-all cursor-pointer"
          >
            + Thêm dự án mới
          </button>
        </aside>

        {/* Center Section: Main Editor (Col 6) */}
        <section className="lg:col-span-6 lg:order-2 flex flex-col space-y-6">
          
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-[#1E2023] text-xs text-[#E5A158] rounded-full border border-[#3D3F43] font-medium">
                Tiếng Việt (VN)
              </span>
              <span className="px-3 py-1 bg-transparent text-xs text-[#808080] rounded-full border border-[#2D2F33]">
                {text.length}/3000 ký tự
              </span>
            </div>
            <div className="text-xs text-[#606060] italic">Tự động đồng bộ đám mây</div>
          </div>

          {/* Form wrapper */}
          <form onSubmit={generateVoice} className="space-y-6">
            <div className="relative">
              <textarea
                id="tts_textarea"
                value={text}
                onChange={(e) => {
                  let val = e.target.value;
                  if (val.length > 3000) {
                    val = val.substring(0, 3000);
                    setError("Văn bản vượt quá giới hạn 3000 ký tự và đã được tự động cắt ngắn.");
                  } else {
                    setError(null);
                  }
                  setText(val);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const pastedText = e.clipboardData.getData("text") || "";
                  
                  // Clean up ChatGPT's typical Markdown syntax for clear vocal synthesis
                  const cleanedText = cleanMarkdownForTTS(pastedText);
                  
                  // Stitch text around cursor selection
                  const textarea = e.currentTarget;
                  const start = textarea.selectionStart || 0;
                  const end = textarea.selectionEnd || 0;
                  const currentVal = textarea.value || "";
                  
                  let newVal = currentVal.substring(0, start) + cleanedText + currentVal.substring(end);
                  
                  if (newVal.length > 3000) {
                    newVal = newVal.substring(0, 3000);
                    setError("Đã tự động định dạng và giới hạn văn bản dán từ ChatGPT ở mức 3000 ký tự.");
                  } else {
                    setError(null);
                  }
                  setText(newVal);
                }}
                placeholder="Nhập hoặc dán văn bản của bạn tại đây để chuyển đổi sang giọng nói..."
                className="w-full h-48 bg-[#16181A] border border-[#2D2F33] rounded-xl p-6 text-lg leading-relaxed text-[#D0D0D0] focus:outline-none focus:border-[#E5A158] resize-none shadow-inner placeholder-[#404040] transition-colors"
              />
            </div>

            {/* Quick Templates tag block */}
            <div className="space-y-2">
              <p className="text-xs text-[#606060] uppercase tracking-wider font-bold">
                Chọn văn bản mẫu
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyTemplate(ex.text)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[#2D2F33] bg-[#121416] text-[#A0A0A0] hover:border-[#E5A158] hover:text-[#E5A158] hover:bg-[#1E2023] transition-all cursor-pointer"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Voice select grid */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest text-[#606060] block">
                Cấu hình giọng nói (Mô hình Gemini Voice)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VOICES.map((v) => {
                  const isSelected = selectedVoice === v.id;
                  const isMale = v.gender === "nam";
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoice(v.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between relative cursor-pointer group ${
                        isSelected
                          ? "bg-[#1E2023] border-[#E5A158] shadow-md shadow-[#E5A158]/5"
                          : "bg-[#121416]/40 border-[#2D2F33] text-[#A0A0A0] hover:border-[#3D3F43] hover:bg-[#1E2023]"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className={`text-sm font-bold transition-all ${isSelected ? "text-[#E5A158]" : "text-[#D0D0D0]"}`}>
                          {v.name}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                          isMale ? "bg-cyan-950/60 text-cyan-400 border border-cyan-800/40" : "bg-purple-950/60 text-purple-400 border border-purple-800/40"
                        }`}>
                          {v.gender}
                        </span>
                      </div>
                      <p className="text-xs text-[#808080] line-clamp-1 group-hover:text-[#A0A0A0] transition-all">
                        {v.description}
                      </p>
                      <span className="text-[9px] mt-2 font-mono text-[#606060] block">
                        {v.badge}
                      </span>
                      
                      {isSelected && (
                        <div className="absolute right-3 bottom-3 h-4 w-4 bg-[#E5A158] rounded-full flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-black stroke-[3px]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error alerts */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs leading-relaxed"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit execution block */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-[#E5A158] hover:opacity-95 disabled:bg-[#1E2023] disabled:text-[#606060] disabled:cursor-not-allowed font-bold text-sm text-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-[#E5A158]/10"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-black" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>ĐANG TỔNG HỢP GIỌNG NÓI...</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  <span>XUẤT GIỌNG NÓI ĐÁM MÂY</span>
                </>
              )}
            </button>
          </form>
        </section>

        {/* Sidebar Right: Controls & Player (Col 3) */}
        <aside className="lg:col-span-3 lg:order-3 flex flex-col space-y-6">
          
          {/* Real-time sound player */}
          <div className="bg-[#121416] border border-[#2D2F33] rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#606060] border-b border-[#2D2F33] pb-2.5">
              Bộ phát âm thanh
            </h3>

            {/* Oscilloscope Visualizer Box */}
            <div className="relative rounded-xl overflow-hidden border border-[#2D2F33] bg-[#16181A] h-24 flex flex-col justify-between p-3.5 shadow-inner">
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                width={300}
                height={96}
              />
              <div className="relative z-10 flex justify-between items-start w-full">
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[#121416]/90 border border-[#2D2F33] rounded text-[#E5A158] font-medium tracking-wider">
                  {selectedVoice}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[#121416]/90 border border-[#2D2F33] rounded text-[#808080] font-medium tracking-wider uppercase">
                  WAV 24KHZ
                </span>
              </div>
            </div>

            {/* Audio timelines & slider */}
            <div className="space-y-1.5">
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                disabled={!audioBufferRef.current}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full cursor-pointer h-1.5 bg-[#2D2F33] rounded-lg appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between items-center text-[10px] text-[#808080] font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Player Main Trigger Panel */}
            <div className="flex items-center justify-between gap-2.5 pt-1">
              {/* Loop */}
              <button
                type="button"
                disabled={!audioBufferRef.current}
                onClick={() => setIsLooping(!isLooping)}
                className={`p-2 rounded-lg border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                  isLooping 
                    ? "bg-[#1E2023] border-[#E5A158] text-[#E5A158]" 
                    : "bg-transparent border-[#2D2F33] text-[#808080] hover:text-white hover:bg-[#1E2023]"
                }`}
                title="Vòng lặp"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              {/* Playback trigger center */}
              <div className="flex items-center gap-2.5">
                {/* Stop */}
                <button
                  type="button"
                  disabled={!audioBufferRef.current}
                  onClick={stopAudio}
                  className="p-2.5 rounded-full border border-[#2D2F33] bg-[#16181A] hover:bg-[#2D2F33] text-[#A0A0A0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <Square className="h-3.5 w-3.5 fill-[#A0A0A0] stroke-none" />
                </button>

                {/* Play/Pause */}
                <button
                  type="button"
                  disabled={!audioBufferRef.current}
                  onClick={() => {
                    if (isPlaying) {
                      pauseAudio();
                    } else {
                      playAudio();
                    }
                  }}
                  className="p-4 rounded-full bg-[#E5A158] text-black hover:scale-105 disabled:bg-[#2D2F33] disabled:text-[#606060] disabled:shadow-none disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-current text-black stroke-none" />
                  ) : (
                    <Play className="h-5 w-5 fill-current text-black translate-x-0.5 stroke-none" />
                  )}
                </button>
              </div>

              {/* Download WAV button */}
              <button
                type="button"
                disabled={!audioBase64}
                onClick={downloadWav}
                className="p-2 rounded-lg border border-[#2D2F33] bg-transparent text-[#808080] hover:text-white hover:bg-[#1E2023] disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Tải tệp WAV"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>

            {/* Mute and volume slider */}
            <div className="flex items-center gap-3 bg-[#16181A] border border-[#2D2F33] p-2.5 rounded-xl">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className="text-[#808080] hover:text-white transition-all cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  if (isMuted) setIsMuted(false);
                }}
                className="flex-1 cursor-pointer h-1 bg-[#2D2F33] rounded-lg appearance-none"
              />
            </div>
          </div>

          {/* Real-time fine tuner parameters */}
          <div className="bg-[#121416] border border-[#2D2F33] rounded-xl p-5 space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#606060] border-b border-[#2D2F33] pb-2.5">
              Tinh chỉnh chất âm
            </h3>

            {/* Bass boost switch */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#16181A] border border-[#2D2F33]">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-white block">Bộ lọc trầm ấm (Bass Boost)</span>
                <span className="text-[9px] text-[#808080] block">Tăng dải tần số thấp (120Hz)</span>
              </div>
              <button
                type="button"
                onClick={() => setBassBoost(!bassBoost)}
                className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-300 focus:outline-none cursor-pointer ${
                  bassBoost ? "bg-[#E5A158]" : "bg-[#2D2F33]"
                }`}
              >
                <div className={`w-4.5 h-4.5 rounded-full bg-white transition-transform duration-300 ${
                  bassBoost ? "translate-x-4.5 bg-black" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Playback speed slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#A0A0A0]">Tốc độ đọc (Speed)</span>
                <span className="text-[#E5A158] font-mono font-bold text-xs">{speed.toFixed(1)}x</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-[#606060] font-bold font-mono">0.5x</span>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="flex-1 cursor-pointer h-1 bg-[#2D2F33] rounded-lg appearance-none"
                />
                <span className="text-[9px] text-[#606060] font-bold font-mono">2.0x</span>
              </div>
            </div>

            {/* Pitch/Tone Slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#A0A0A0]">Cao độ (Pitch)</span>
                <span className="text-[#E5A158] font-mono font-bold text-xs">{pitch > 0 ? `+${pitch}` : pitch}c</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-[#606060] font-bold font-mono">-1200c</span>
                <input
                  type="range"
                  min="-1200"
                  max="1200"
                  step="50"
                  value={pitch}
                  onChange={(e) => setPitch(parseInt(e.target.value))}
                  className="flex-1 cursor-pointer h-1 bg-[#2D2F33] rounded-lg appearance-none"
                />
                <span className="text-[9px] text-[#606060] font-bold font-mono">+1200c</span>
              </div>
            </div>

            {/* Output formats buttons block */}
            <div className="pt-2 border-t border-[#2D2F33] space-y-2.5">
              <span className="text-[10px] uppercase tracking-widest text-[#606060] font-bold block">Định dạng xuất</span>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="py-2 rounded bg-[#1E2023] border border-[#3D3F43] text-xs text-white cursor-pointer hover:border-[#E5A158] transition-all">
                  WAV (Lossless)
                </button>
                <button type="button" className="py-2 rounded bg-transparent border border-[#2D2F33] text-xs text-[#808080] hover:text-[#A0A0A0] transition-all">
                  MP3 (320kbps)
                </button>
              </div>
            </div>
          </div>

        </aside>

      </main>

      {/* Footer Status Bar matching template design exactly */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t border-[#2D2F33] flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] text-[#505050] font-medium uppercase tracking-widest">
        <div className="flex flex-wrap gap-4 sm:gap-6 justify-center">
          <span>Phiên bản 2.4.0 (Stable)</span>
          <span>•</span>
          <span>Vị trí máy chủ: Singapore (SG-01)</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-[#E5A158]">● Sẵn sàng</span>
          <span>•</span>
          <span>Hỗ trợ khách hàng</span>
        </div>
      </footer>
    </div>
  );
}
