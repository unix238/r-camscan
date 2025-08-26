// src/Receiver.jsx
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "http://77.110.121.102/";

const Button = ({ onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      margin: 6,
      padding: "8px 16px",
      fontSize: 16,
      borderRadius: 4,
      border: "1px solid #ccc",
      background: "#f7f7f7",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

export default function Receiver() {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);

  const [isPlayback, setIsPlayback] = useState(false);

  const liveStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // -------------------
  // Controls
  // -------------------
  const handlePlay = () => videoRef.current?.play();
  const handlePause = () => videoRef.current?.pause();

  const handleSpeedUp = () => {
    if (videoRef.current) {
      videoRef.current.playbackRate = Math.min(
        videoRef.current.playbackRate + 0.25,
        4
      );
    }
  };
  const handleSpeedDown = () => {
    if (videoRef.current) {
      videoRef.current.playbackRate = Math.max(
        videoRef.current.playbackRate - 0.25,
        0.25
      );
    }
  };

  const handleBack5s = () => {
    if (isPlayback && videoRef.current) {
      videoRef.current.currentTime = Math.max(
        videoRef.current.currentTime - 5,
        0
      );
    }
  };

  const handleForward5s = () => {
    if (isPlayback && videoRef.current) {
      videoRef.current.currentTime = Math.min(
        videoRef.current.currentTime + 5,
        videoRef.current.duration
      );
    }
  };

  const handleFrameNext = () => {
    if (isPlayback && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime += 1 / 30;
    }
  };
  const handleFramePrev = () => {
    if (isPlayback && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = Math.max(
        videoRef.current.currentTime - 1 / 30,
        0
      );
    }
  };

  // -------------------
  // Recording logic
  // -------------------
  const startRecording = (stream) => {
    if (recorderRef.current) return; // already recording

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);

        // rolling buffer: keep last ~5 minutes
        const MAX_SIZE = 1000; // ~500s if 500ms per chunk
        if (chunksRef.current.length > MAX_SIZE) {
          chunksRef.current.shift();
        }
      }
    };

    recorder.start(500);
    recorderRef.current = recorder;
  };

  const enterPlayback = () => {
    if (!chunksRef.current.length) return;

    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    const url = URL.createObjectURL(blob);

    videoRef.current.srcObject = null;
    videoRef.current.src = url;
    videoRef.current.controls = true;
    videoRef.current.play();
    setIsPlayback(true);
  };

  const backToLive = () => {
    if (liveStreamRef.current) {
      videoRef.current.src = "";
      videoRef.current.srcObject = liveStreamRef.current;
      videoRef.current.controls = false;
      videoRef.current.play();
      setIsPlayback(false);
    }
  };

  // -------------------
  // WebRTC setup
  // -------------------
  useEffect(() => {
    socketRef.current = io(SERVER_URL, {
      transports: ["websocket"],
    });

    pcRef.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pcRef.current.addTransceiver("video", { direction: "recvonly" });

    pcRef.current.ontrack = (event) => {
      const stream = event.streams[0];
      liveStreamRef.current = stream;
      if (videoRef.current && !isPlayback) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      startRecording(stream);
    };

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", event.candidate);
      }
    };

    socketRef.current.on("connect", () => {
      socketRef.current.emit("register", { role: "receiver" });
    });

    socketRef.current.on("offer", async (offer) => {
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socketRef.current.emit("answer", answer);
    });

    socketRef.current.on("ice-candidate", (candidate) => {
      if (candidate)
        pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    });

    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
      recorderRef.current?.stop();
    };
  }, []);

  // -------------------
  // UI
  // -------------------
  return (
    <div style={{ textAlign: "center", padding: 20 }}>
      <h2>Receiver</h2>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: 720,
          maxWidth: 720,
          height: 480,
          background: "black",
          objectFit: "contain",
        }}
      />
      <div style={{ marginTop: 16 }}>
        {!isPlayback && <Button onClick={enterPlayback}>PLAYBACK MODE</Button>}
        {isPlayback && (
          <>
            <Button onClick={handlePlay}>PLAY</Button>
            <Button onClick={handlePause}>PAUSE</Button>
            <Button onClick={handleSpeedDown}>SPEED-</Button>
            <Button onClick={handleSpeedUp}>SPEED+</Button>
            <Button onClick={handleBack5s}>-5s</Button>
            <Button onClick={handleForward5s}>+5s</Button>
            <Button onClick={handleFramePrev}>FRAME-</Button>
            <Button onClick={handleFrameNext}>FRAME+</Button>
            <Button onClick={backToLive}>LIVE VIEW</Button>
          </>
        )}
      </div>
      {isPlayback && (
        <p style={{ marginTop: 10, color: "green" }}>
          You are in playback mode. Live stream is still being recorded in the
          background. Click <b>LIVE VIEW</b> to return to live.
        </p>
      )}
    </div>
  );
}
