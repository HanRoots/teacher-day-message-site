const form = document.querySelector('#messageForm');
const teacherInput = document.querySelector('#teacher');
const messageInput = document.querySelector('#message');
const senderInput = document.querySelector('#sender');
const characterCount = document.querySelector('#characterCount');
const promptButtons = [...document.querySelectorAll('.prompt-chip')];
const recordButton = document.querySelector('#recordButton');
const stopButton = document.querySelector('#stopButton');
const rerecordButton = document.querySelector('#rerecordButton');
const playButton = document.querySelector('#playButton');
const voiceIdle = document.querySelector('#voiceIdle');
const recordingState = document.querySelector('#recordingState');
const voiceReady = document.querySelector('#voiceReady');
const recordingTime = document.querySelector('#recordingTime');
const durationLabel = document.querySelector('#duration');
const audioPreview = document.querySelector('#audioPreview');
const voiceError = document.querySelector('#voiceError');
const formError = document.querySelector('#formError');
const submitButton = document.querySelector('#submitButton');
const successToast = document.querySelector('#successToast');
const closeToast = document.querySelector('#closeToast');
const waveform = document.querySelector('#waveform');
const API_BASE = String(window.APP_CONFIG?.apiBase || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE}${path}`;
const API_CONFIGURED = Boolean(API_BASE) || ['localhost', '127.0.0.1'].includes(location.hostname);

let recorder;
let mediaStream;
let chunks = [];
let audioBlob = null;
let audioObjectUrl = '';
let audioDuration = 0;
let timerId;
let recordStartedAt = 0;

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function buildWaveform() {
  const heights = [9,14,20,11,24,16,28,12,21,15,25,11,18,9,14,7,10,6,8,5,7,5];
  waveform.innerHTML = heights.map(height => `<i style="height:${height}px"></i>`).join('');
}
buildWaveform();

messageInput.addEventListener('input', () => {
  characterCount.textContent = `${messageInput.value.length}/500`;
});

promptButtons.forEach(button => {
  button.addEventListener('click', () => {
    const sentence = button.textContent.trim();
    button.classList.toggle('selected');
    if (!messageInput.value.includes(sentence)) {
      messageInput.value = `${messageInput.value.trim()}${messageInput.value.trim() ? '，' : ''}${sentence}。`;
      messageInput.dispatchEvent(new Event('input'));
    }
    messageInput.focus();
  });
});

function resetVoice() {
  clearInterval(timerId);
  if (recorder && recorder.state === 'recording') recorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  recorder = null;
  mediaStream = null;
  audioBlob = null;
  audioObjectUrl = '';
  audioDuration = 0;
  audioPreview.removeAttribute('src');
  playButton.classList.remove('playing');
  voiceIdle.hidden = false;
  recordingState.hidden = true;
  voiceReady.hidden = true;
  voiceError.textContent = '';
}

async function startRecording() {
  voiceError.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    voiceError.textContent = '当前浏览器暂不支持录音，请使用最新版微信、Safari 或 Chrome。';
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = preferredType ? new MediaRecorder(mediaStream, { mimeType: preferredType }) : new MediaRecorder(mediaStream);
    chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = finishRecording;
    recorder.start(250);
    recordStartedAt = Date.now();
    voiceIdle.hidden = true;
    voiceReady.hidden = true;
    recordingState.hidden = false;
    recordingTime.textContent = '00:00 / 01:00';
    timerId = setInterval(() => {
      const elapsed = Math.min(60, (Date.now() - recordStartedAt) / 1000);
      recordingTime.textContent = `${formatTime(elapsed)} / 01:00`;
      if (elapsed >= 60) stopRecording();
    }, 250);
  } catch (error) {
    voiceError.textContent = error.name === 'NotAllowedError' ? '需要开启麦克风权限，才能录下想说的话。' : '暂时无法录音，请稍后再试。';
  }
}

function stopRecording() {
  clearInterval(timerId);
  if (recorder?.state === 'recording') recorder.stop();
}

function finishRecording() {
  audioDuration = Math.min(60, (Date.now() - recordStartedAt) / 1000);
  mediaStream?.getTracks().forEach(track => track.stop());
  const type = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
  audioBlob = new Blob(chunks, { type });
  audioObjectUrl = URL.createObjectURL(audioBlob);
  audioPreview.src = audioObjectUrl;
  durationLabel.textContent = formatTime(audioDuration);
  recordingState.hidden = true;
  voiceReady.hidden = false;
}

recordButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
rerecordButton.addEventListener('click', resetVoice);

playButton.addEventListener('click', async () => {
  if (audioPreview.paused) {
    await audioPreview.play();
    playButton.classList.add('playing');
  } else {
    audioPreview.pause();
    playButton.classList.remove('playing');
  }
});

audioPreview.addEventListener('timeupdate', () => {
  const progress = audioPreview.duration ? audioPreview.currentTime / audioPreview.duration : 0;
  const bars = [...waveform.children];
  bars.forEach((bar, index) => bar.classList.toggle('active', index / bars.length <= progress));
});
audioPreview.addEventListener('ended', () => playButton.classList.remove('playing'));

async function uploadAudio(blob) {
  const policyResponse = await fetch(apiUrl('/api/oss/policy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: blob.type || 'audio/webm' })
  });
  if (!policyResponse.ok) throw new Error('无法获取上传凭证');
  const policy = await policyResponse.json();

  if (policy.enabled) {
    const data = new FormData();
    data.append('key', policy.key);
    data.append('OSSAccessKeyId', policy.accessId);
    data.append('policy', policy.policy);
    data.append('Signature', policy.signature);
    data.append('success_action_status', '200');
    data.append('Content-Type', blob.type || 'audio/webm');
    data.append('file', blob, policy.key.split('/').pop());
    const upload = await fetch(policy.host, { method: 'POST', body: data });
    if (!upload.ok) throw new Error('语音上传失败，请检查 OSS 跨域配置');
    return { audioUrl: policy.publicUrl, audioKey: policy.key };
  }

  const upload = await fetch(apiUrl('/api/audio'), {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob
  });
  if (!upload.ok) throw new Error('语音上传失败');
  return upload.json();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  formError.textContent = '';
  if (!API_CONFIGURED) {
    formError.textContent = '云端留言服务正在连接中，请稍后再来。';
    return;
  }
  const teacher = teacherInput.value.trim();
  const message = messageInput.value.trim();
  if (!teacher) {
    formError.textContent = '请先写下老师的称呼。';
    teacherInput.focus();
    return;
  }
  if (!message && !audioBlob) {
    formError.textContent = '写一句祝福，或录一段想说的话吧。';
    messageInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.querySelector('span').textContent = audioBlob ? '正在保存语音…' : '正在送出…';
  try {
    let audio = { audioUrl: '', audioKey: '' };
    if (audioBlob) audio = await uploadAudio(audioBlob);
    const response = await fetch(apiUrl('/api/messages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher,
        message,
        sender: senderInput.value.trim(),
        audioUrl: audio.audioUrl,
        audioKey: audio.audioKey,
        duration: audioDuration
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '留言提交失败');
    form.reset();
    characterCount.textContent = '0/500';
    promptButtons.forEach(button => button.classList.remove('selected'));
    resetVoice();
    successToast.hidden = false;
  } catch (error) {
    formError.textContent = error.message || '暂时没有送达，请稍后再试。';
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span').textContent = '送出这份心意';
  }
});

closeToast.addEventListener('click', () => { successToast.hidden = true; });
