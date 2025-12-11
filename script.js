/* script.js — improved, robust version
   Requirements:
   - models/tiny_face_detector/
       - tiny_face_detector_model-weights_manifest.json
       - tiny_face_detector_model-shard1
   - models/face_expression/
       - face_expression_model-weights_manifest.json
       - face_expression_model-shard1
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
let lastEmotion = null;
let lastEmotionAt = 0;
const EMOTION_COOLDOWN_MS = 1400; // don't repeat animations/audio more often than this

// Mapping for messages and simple motifs
const EMOTION_CONFIG = {
  neutral:  { label:'Calm',        line:"You have that serene glow — camera can't keep up.", melody:[440,660,880] },
  happy:    { label:'Happy',       line:"Your smile should be a crime — stealing hearts everywhere.", melody:[660,880,990,1320] },
  sad:      { label:'A little blue', line:"If sadness was an art, you'd still be a masterpiece — here, smile?", melody:[330,247,220] },
  angry:    { label:'Fiery',       line:"Your intensity is impressive — but your smile would be lethal.", melody:[220,196,174] },
  fearful:  { label:'Surprised',   line:"Don't worry — the camera's only afraid of your beauty.", melody:[880,740,660] },
  disgusted:{ label:'Hmm',         line:"Even when you're picky, you look absolutely stunning.", melody:[330,392,494] },
  surprised:{ label:'Surprised',   line:"Wow — you just took my breath away all over again.", melody:[990,1320,1650] }
};

// play a short motif via WebAudio (safe-guarded)
function playMotif(freqs, duration = 0.42) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    masterGain.connect(audioCtx.destination);

    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now + i * 0.03);
      g.gain.setValueAtTime(0.06, now + i * 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration + i * 0.02);
      osc.stop(now + duration + i * 0.03);
    });
  } catch (e) {
    // browsers require a user gesture for audio in some cases; ignore silently
    console.warn('Audio play error', e);
  }
}

// spawn a heart animation
function spawnHeart() {
  const h = document.createElement('div');
  h.className = 'heart';
  const left = 18 + Math.random() * Math.max(0, heartsEl.clientWidth - 36);
  h.style.left = `${left}px`;
  h.style.top = `${heartsEl.clientHeight - 40}px`;
  heartsEl.appendChild(h);
  h.style.opacity = '1';
  h.style.transform = 'translate(-50%,0)';
  h.style.animation = `floatUp 1.6s ease-out forwards`;
  setTimeout(() => h.remove(), 1800);
}

// update UI for emotion: text + hearts + sound
function showCuteFor(emotionKey) {
  const cfg = EMOTION_CONFIG[emotionKey] || EMOTION_CONFIG['neutral'];
  emotionLabel.textContent = cfg.label;
  cuteTitle.textContent = `You look ${cfg.label.toLowerCase()}...`;
  cuteMessage.textContent = cfg.line;

  // Spawn a few hearts
  for (let i = 0; i < 3; i++) setTimeout(spawnHeart, i * 160);

  // Play motif
  playMotif(cfg.melody);
}

// resize overlay canvas to video dimensions
function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

// Load models from local models folder — exact folder names required
async function initModels() {
    loader.textContent = 'Loading face models…';

    await faceapi.nets.tinyFaceDetector.loadFromUri('./models/tiny_face_detector');
    await faceapi.nets.faceExpressionNet.loadFromUri('./models/face_expression');

    loader.style.display = 'none';
}


// TinyFace detector options (reuse)
const tinyFaceOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 224,    // 224 is a good tradeoff between speed/accuracy
  scoreThreshold: 0.5
});

// start camera and set detection interval
async function startVideo() {
  if (streamActive) {
    stopVideo();
    await new Promise(r => setTimeout(r, 250));
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    streamActive = true;

    // when frames are ready
    video.addEventListener('loadeddata', () => {
      resizeCanvas();
      if (detectionInterval) clearInterval(detectionInterval);
      // run detection ~6 fps (every 160ms)
      detectionInterval = setInterval(detectExpression, 160);
    }, { once: true });
  } catch (err) {
    loader.textContent = 'Camera access denied or not available.';
    console.error('getUserMedia error', err);
  }
}

// stop camera / detection
function stopVideo() {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  streamActive = false;
}

// main detection routine (safe with try/catch)
async function detectExpression() {
  try {
    if (video.readyState < 2) return;
    // detect faces + expressions
    const detections = await faceapi.detectAllFaces(video, tinyFaceOptions).withFaceExpressions();
    canvasCtx.clearRect(0, 0, overlay.width, overlay.height);

    if (!detections || detections.length === 0) {
      emotionLabel.textContent = '—';
      return;
    }

    // use the first face for UI
    const r = detections[0];
    const { expressions, detection } = r;
    const box = detection.box;

    // draw bounding box
    canvasCtx.strokeStyle = 'rgba(201,159,107,0.95)';
    canvasCtx.lineWidth = Math.max(2, Math.round(overlay.width / 320));
    canvasCtx.strokeRect(box.x, box.y, box.width, box.height);

    // pick top expression
    const sorted = Object.entries(expressions).sort((a,b) => b[1] - a[1]);
    const [topKey, topScore] = sorted[0];

    // update UI only when confident enough and respect cooldown
    if (topScore > 0.35) {
      const now = Date.now();
      if (topKey !== lastEmotion || (now - lastEmotionAt) > EMOTION_COOLDOWN_MS) {
        lastEmotion = topKey;
        lastEmotionAt = now;
        // normalize keys (face-api keys: happy, sad, angry, surprised, disgusted, fearful, neutral)
        let key = topKey;
        if (key === 'fearful') key = 'fearful';
        if (key === 'disgusted') key = 'disgusted';
        // show UI & play motif
        showCuteFor(key);
      }
    }
  } catch (e) {
    // catch any error to avoid stopping the interval
    console.error('detectExpression error', e);
  }
}

// Wire UI interactions
toggleBtn.addEventListener('click', async () => {
  try {
    if (!streamActive) {
      // load models if not loaded
      const detectorLoaded = !!(faceapi.nets && faceapi.nets.tinyFaceDetector && faceapi.nets.tinyFaceDetector.params);
      if (!detectorLoaded) {
        await initModels();
      }
      await startVideo();
    } else {
      stopVideo();
      loader.style.display = '';
      loader.textContent = 'Camera stopped';
    }
  } catch (e) {
    console.error('toggleBtn error', e);
    loader.textContent = 'Error starting camera. See console.';
  }
});

// on page load -> pre-load models to reduce latency
window.addEventListener('load', async () => {
  try {
    await initModels();
    loader.style.display = 'none';
  } catch (e) {
    loader.textContent = 'Error loading models. See console.';
  }
});

// handle resize so canvas matches video
window.addEventListener('resize', resizeCanvas);
video.addEventListener('loadedmetadata', resizeCanvas);

