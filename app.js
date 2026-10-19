
let phrases = [];
let currentIndex = Number(localStorage.getItem('p500_current') || 0);
let done = JSON.parse(localStorage.getItem('p500_done') || '[]');
let stars = Number(localStorage.getItem('p500_stars') || 0);
let mediaRecorder = null;
let chunks = [];
let currentBlob = null;
let stream = null;

const $ = s => document.querySelector(s);

function saveState(){
  localStorage.setItem('p500_current', currentIndex);
  localStorage.setItem('p500_done', JSON.stringify(done));
  localStorage.setItem('p500_stars', stars);
}

function updateStreak(){
  const today = new Date().toISOString().slice(0,10);
  let data = JSON.parse(localStorage.getItem('p500_streak') || '{"last":"","count":0}');
  if(data.last !== today){
    const y = new Date(); y.setDate(y.getDate()-1);
    const yesterday = y.toISOString().slice(0,10);
    data.count = data.last === yesterday ? data.count + 1 : 1;
    data.last = today;
    localStorage.setItem('p500_streak', JSON.stringify(data));
  }
  return data.count;
}

function render(){
  if(!phrases.length) return;
  currentIndex = Math.max(0, Math.min(currentIndex, phrases.length-1));
  const p = phrases[currentIndex];
  $('#phraseNo').textContent = `Phrase ${p.id} of ${phrases.length}`;
  $('#phraseText').textContent = p.text;
  $('#benchmark').style.display = p.benchmark ? 'inline-block' : 'none';
  $('#doneBtn').textContent = done.includes(p.id) ? '✓ Completed' : '✓ Mark complete';
  $('#doneBtn').className = done.includes(p.id) ? 'success' : 'primary';
  $('#prevBtn').disabled = currentIndex===0;
  $('#nextBtn').disabled = currentIndex===phrases.length-1;
  $('#player').style.display = 'none';
  $('#downloadBtn').disabled = true;
  currentBlob = null;
  $('#speakBtn').disabled = false;
  $('#speakBtn').textContent = '▶ Listen';
  updateStats();
  updateCheckpointLock(p);
}

async function updateCheckpointLock(p){
  if(!p.benchmark) return;
  const existing = await dbGet(p.id);
  if(!existing && phrases[currentIndex]?.id === p.id){
    $('#speakBtn').disabled = true;
    $('#speakBtn').textContent = '🔒 Listen after first recording';
  }
}

function updateStats(){
  const pct = phrases.length ? Math.round(done.length/phrases.length*100) : 0;
  $('#progress').style.width = `${pct}%`;
  $('#progressText').textContent = `${done.length}/${phrases.length} complete`;
  $('#stars').textContent = `⭐ ${stars}`;
  $('#streak').textContent = `🔥 ${updateStreak()} day streak`;
}

function speak(){
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(phrases[currentIndex].text);
  u.lang = 'en-US';
  u.rate = 0.82;
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang?.toLowerCase().startsWith('en-us')) ||
                    voices.find(v => v.lang?.toLowerCase().startsWith('en'));
  if(preferred) u.voice = preferred;
  speechSynthesis.speak(u);
}

async function startRecording(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    chunks = [];
    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? {mimeType:'audio/webm;codecs=opus'} : {};
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      currentBlob = new Blob(chunks, {type: mediaRecorder.mimeType || 'audio/webm'});
      const url = URL.createObjectURL(currentBlob);
      $('#player').src = url;
      $('#player').style.display = 'block';
      $('#downloadBtn').disabled = false;
      await dbSave(phrases[currentIndex].id, currentBlob);
      renderRecordings();
      stream?.getTracks().forEach(t=>t.stop());
    };
    mediaRecorder.start();
    $('#recordBtn').textContent = '■ Stop recording';
    $('#recordBtn').classList.add('recording');
  }catch(err){
    alert('Microphone access is required. If you opened the app as a local file, use HTTPS or localhost.');
  }
}

function stopRecording(){
  if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  $('#recordBtn').textContent = '🎙 Record';
  $('#recordBtn').classList.remove('recording');
}

function toggleRecording(){
  if(mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  else startRecording();
}

function markDone(){
  const id = phrases[currentIndex].id;
  if(!done.includes(id)){
    done.push(id);
    stars += 1;
  }else{
    done = done.filter(x=>x!==id);
    stars = Math.max(0, stars-1);
  }
  saveState(); render();
}

function go(delta){
  currentIndex += delta; saveState(); render(); window.scrollTo({top:0,behavior:'smooth'});
}

function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

async function downloadCurrent(){
  const p = phrases[currentIndex];
  const blob = currentBlob || await dbGet(p.id);
  if(!blob) return alert('No recording saved for this phrase yet.');
  downloadBlob(blob, `pronunciation_phrase_${String(p.id).padStart(2,'0')}.webm`);
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open('Pronunciation500DB',1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore('recordings',{keyPath:'phraseId'}); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbSave(phraseId, blob){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('recordings','readwrite');
    tx.objectStore('recordings').put({phraseId,blob,updatedAt:new Date().toISOString()});
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
async function dbGet(phraseId){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('recordings').objectStore('recordings').get(phraseId);
    req.onsuccess=()=>resolve(req.result?.blob || null); req.onerror=()=>reject(req.error);
  });
}
async function dbAll(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('recordings').objectStore('recordings').getAll();
    req.onsuccess=()=>resolve(req.result || []); req.onerror=()=>reject(req.error);
  });
}
async function dbDelete(phraseId){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('recordings','readwrite');
    tx.objectStore('recordings').delete(phraseId);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
async function renderRecordings(){
  const list = $('#recordingList');
  const all = (await dbAll()).sort((a,b)=>a.phraseId-b.phraseId);
  if(!all.length){
    list.innerHTML = '<div class="notice">No recordings yet. Record a phrase and it will appear here.</div>';
    return;
  }
  list.innerHTML='';
  for(const r of all){
    const p=phrases.find(x=>x.id===r.phraseId);
    const div=document.createElement('div'); div.className='item';
    div.innerHTML=`<div><strong>Phrase ${r.phraseId}</strong><small>${p?.text || ''}</small></div>`;
    const actions=document.createElement('div'); actions.className='item-actions';
    const play=document.createElement('button'); play.textContent='▶ Play'; play.onclick=()=>{new Audio(URL.createObjectURL(r.blob)).play();};
    const dl=document.createElement('button'); dl.textContent='⬇ Download'; dl.onclick=()=>downloadBlob(r.blob,`pronunciation_phrase_${String(r.phraseId).padStart(2,'0')}.webm`);
    const del=document.createElement('button'); del.textContent='Delete'; del.onclick=async()=>{if(confirm('Delete this local recording?')){await dbDelete(r.phraseId); renderRecordings();}};
    actions.append(play,dl,del); div.append(actions); list.append(div);
  }
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===name));
  if(name==='recordings') renderRecordings();
}

async function init(){
  phrases = await fetch('./phrases.json').then(r=>r.json());
  render();
  $('#speakBtn').onclick=speak;
  $('#recordBtn').onclick=toggleRecording;
  $('#downloadBtn').onclick=downloadCurrent;
  $('#doneBtn').onclick=markDone;
  $('#prevBtn').onclick=()=>go(-1);
  $('#nextBtn').onclick=()=>go(1);
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}
window.addEventListener('load',init);
