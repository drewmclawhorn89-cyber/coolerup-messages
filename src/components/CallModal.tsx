import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { Avatar } from './Avatar';

interface CallModalProps {
  mode: 'voice' | 'video';
  peerName: string;
  peerPhotoURL?: string;
  peerAvatarSeed?: string;
  onEndCall: (durationSec: number) => void;
}

export function CallModal({
  mode,
  peerName,
  peerPhotoURL,
  peerAvatarSeed,
  onEndCall,
}: CallModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(mode === 'voice');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mode !== 'video' || camOff) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [mode, camOff]);

  const formattedTime = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(
    elapsedSec % 60
  ).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm h-[540px] rounded-3xl overflow-hidden bg-gradient-to-b from-slate-900 to-black border border-white/10 shadow-2xl flex flex-col items-center justify-between p-6 text-white">
        {mode === 'video' && !camOff && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover opacity-55 -scale-x-100 pointer-events-none"
          />
        )}

        <div className="relative z-10 text-center mt-4">
          <span className="inline-block px-3 py-1 rounded-full bg-white/15 text-[11px] font-semibold uppercase tracking-wider mb-2">
            {mode === 'video' ? 'Video Call' : 'Voice Call'}
          </span>
          <h3 className="font-display text-2xl font-bold">{peerName}</h3>
          <p className="text-sm font-mono-tabular text-[#FFFC00] mt-1">
            {elapsedSec < 3 ? 'Ringing...' : formattedTime}
          </p>
        </div>

        <div className="relative z-10 p-2 rounded-full ring-4 ring-[#FFFC00]/60 shadow-xl">
          <Avatar
            name={peerName}
            photoURL={peerPhotoURL}
            avatarSeed={peerAvatarSeed}
            size="xl"
          />
        </div>

        <div className="relative z-10 flex items-center gap-4 mb-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
              muted ? 'bg-white text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {mode === 'video' && (
            <button
              type="button"
              onClick={() => setCamOff((c) => !c)}
              aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}
              className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
                camOff ? 'bg-white text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setSpeakerOn((s) => !s)}
            aria-label="Toggle speaker"
            className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
              speakerOn ? 'bg-white/25 text-[#FFFC00]' : 'bg-white/15 text-white'
            }`}
          >
            <Volume2 className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => onEndCall(elapsedSec)}
            aria-label="End call"
            className="w-14 h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center cursor-pointer shadow-lg"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
