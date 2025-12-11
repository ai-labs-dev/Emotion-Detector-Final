/* script.js (compact version)
   Make sure models folder is present with:
   - models/tiny_face_detector/tiny_face_detector_model-weights_manifest.json
   - models/tiny_face_detector/shard1
   - models/face_expression/face_expression_model-weights_manifest.json
   - models/face_expression/shard1  (if available)
*/
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const canvasCtx = overlay.getContext('2d');
const loader = document.getElementById('loader');
const emotionLabel = document.getElementById('emotionLabel');
const cuteTitle = document.getElementById('cuteTitle');
const cuteMessage = document.getElementById('cuteMessage');
const toggleBtn = document.getElementById('toggleBtn');
const heartsEl = document.getElementById('hearts');

let streamActive = false;
let detectionInterval = null;
let audioCtx = null;

// mapping for messages and simple motifs
const EMOTION_CONFIG = {
  neutral: {label:'Calm', line:"You have that serene glow — camera can't keep up.", melody:[440,660,880]},
  happy: {label:'Happy', line:"Your smile should be a crime — stealing hearts everywhere.", melody:[660,880,990,1320]},
  sad: {label:'A little blue', line:"If sadness was an art, you'd still be a masterpiece — here, smile?", melody:[330,247,220]},
  angry: {label:'Fiery', line:"Your intensity is impressive — but your smile would be lethal.", melody:[220,196,174]},
  fearful: {label:'Surprised', line:"Don't worry — the camera's only afraid of your beauty.", melody:[880,740,660]},
  disgusted: {label:'Hmm', line:"Even when you're picky, you look absolutely stunning.", melody:[330,392,494]},
  surprised: {label:'Surprised', line:"Wow — you just took my breath away all over again.", melody:[990,1320,1650]}
};

function playMotif(freqs, duration = 0.42) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.connect(audioCtx.destination);
    freqs.forEach((f,i)=>{
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type='sine'; osc.frequency.value=f;
      g.gain.value=0.0001;
      osc.connect(g); g.connect(gain);
      osc.start(now + i*0.04);
      g.gain.setValueAtTime(0.06, now + i*0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.stop(now + duration + i*0.02);
    });
  } catch(e){ console.warn('Audio error', e); }
}

function spawnHeart() {
  const h = document.createElement('div');
  h.className = 'heart';
  const left = 18 + Math.random() * (heartsEl.clientWidth - 36);
  h.style.left = `${left}px`;
  h.style.top = `${heartsEl.clientHeight - 40}px`;
  heartsEl.appendChild(h);
  h.style.opacity = '1';
  h.style.transform = 'translate(-50%,0)';
  h.style.animation = `floatUp 1.6s ease-out forwards`;
  setTimeout(()=>h.remove(),1800);
}

function showCuteFor(emotionKey) {
  const cfg = EMOTION_CONFIG[emotionKey] || EMOTION_CONFIG['neutral'];
  emotionLabel.textContent = cfg.label;
  cuteTitle.textContent = `You look ${cfg.label.toLowerCase()}...`;
  cuteMessage.textContent = cfg.line;
  for (let i=0;i<3;i++) setTimeout(spawnHeart,i*180);
  playMotif(cfg.melody.map(n=>n));
}

function resizeCanvas() {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

async function initModels() {
  loader.textContent = 'Loading face models…';
  const MODEL_URL = './models';
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
  loader.style.display = 'none';
}

async function startVideo() {
  if (streamActive) { stopVideo(); await new Promise(r=>setTimeout(r,300)); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    streamActive = true;
    video.addEventListener('loadeddata', () => {
      resizeCanvas();
      if (detectionInterval) clearInterval(detectionInterval);
      detectionInterval = setInterval(detectExpression, 160);
    });
  } catch (e) {
    loader.textContent = 'Camera access denied or not available.';
    console.error('getUserMedia error', e);
  }
}

function stopVideo() {
  detectionInterval && clearInterval(detectionInterval);
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t=>t.stop());
  video.srcObject = null;
  streamActive = false;
}

async function detectExpression() {
  if (video.readyState < 2) return;
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const results = await faceapi.detectAllFaces(video, options).withFaceExpressions();
  canvasCtx.clearRect(0,0,overlay.width,overlay.height);
  if (!results || !results.length) { emotionLabel.textContent='—'; return; }
  const r = results[0];
  const { expressions, detection } = r;
  const box = detection.box;
  canvasCtx.strokeStyle = 'rgba(201,159,107,0.9)';
  canvasCtx.lineWidth = Math.max(2, Math.round(overlay.width / 320));
  canvasCtx.strokeRect(box.x, box.y, box.width, box.height);
  const sorted = Object.entries(expressions).sort((a,b)=>b[1]-a[1]);
  const [topKey, topScore] = sorted[0];
  if (topScore > 0.35) {
    let key = topKey;
    if (key === 'surprised') key = 'surprised';
    if (key === 'fearful') key = 'fearful';
    if (key === 'disgusted') key = 'disgusted';
    if (key === 'angry') key = 'angry';
    if (key === 'happy') key = 'happy';
    if (key === 'sad') key = 'sad';
    showCuteFor(key);
  }
}

toggleBtn.addEventListener('click', async () => {
  if (!streamActive) {
    if (!faceapi.nets.tinyFaceDetector.params) await initModels();
    startVideo();
  } else {
    stopVideo();
    loader.style.display = ''; loader.textContent = 'Camera stopped';
  }
});

window.addEventListener('load', async ()=>{ try{ await initModels(); loader.style.display='none'; } catch(e){ loader.textContent='Error loading models. See console.'; console.error(e); }});
window.addEventListener('resize', resizeCanvas);
