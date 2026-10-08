const form = document.getElementById("predictForm");
const imageInput = document.getElementById("imageInput");
const dropZone = document.getElementById("dropZone");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const predictButton = document.getElementById("predictButton");
const statusText = document.getElementById("statusText");
const statusDot = document.querySelector(".status-dot");

const resultsPanel = document.getElementById("resultsPanel");
const emptyResult = document.getElementById("emptyResult");
const activeResult = document.getElementById("activeResult");
const resultIcon = document.getElementById("resultIcon");
const mainDiagnosis = document.getElementById("mainDiagnosis");
const mainConfidence = document.getElementById("mainConfidence");
const barsContainer = document.getElementById("bars");
const metaContainer = document.getElementById("meta");

// The JSON string injected by Flask
const modelInfo = JSON.parse(document.getElementById("model-info").textContent || "{}");

// SVG Icons
const ICON_HEALTHY = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
const ICON_PARKINSON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

function isParkinson(label) {
  return label.toLowerCase().includes("parkinson");
}

function setSystemStatus(msg, isActive = false) {
  statusText.textContent = msg;
  if (isActive) {
    statusDot.classList.add("active");
  } else {
    statusDot.classList.remove("active");
  }
}

// ==========================================
// Initialization: Render Meta
// ==========================================
function renderMetaInfo(info) {
  if (!info.checkpoint) return;
  metaContainer.innerHTML = `
    <div class="meta-chip">Model <span>${info.checkpoint.split('/').pop()}</span></div>
    <div class="meta-chip">Size <span>${info.image_size}px</span></div>
    <div class="meta-chip">Epoch <span>${info.best_epoch}</span></div>
    <div class="meta-chip">Device <span>${info.device.toUpperCase()}</span></div>
  `;
}
renderMetaInfo(modelInfo);

// ==========================================
// File Drag & Drop
// ==========================================
function handleFileSelection(file) {
  if (!file) {
    previewWrap.style.display = "none";
    previewImage.src = "";
    return;
  }
  const url = URL.createObjectURL(file);
  previewImage.src = url;
  previewWrap.style.display = "block";
  document.querySelector('.zone-content').style.opacity = '0'; // Hide text behind preview
  setSystemStatus("Image loaded. Ready for inference.", true);
  
  // Reset outputs on new image upload
  resultsPanel.className = "panel glass-panel output-panel reveal";
  emptyResult.classList.remove("hidden");
  activeResult.classList.add("hidden");
}

["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    imageInput.files = files;
    handleFileSelection(files[0]);
  }
});

imageInput.addEventListener("change", (e) => {
  handleFileSelection(e.target.files[0]);
});

// ==========================================
// Progress Bars component
// ==========================================
function renderProbabilityBars(probabilities) {
  barsContainer.innerHTML = "";
  
  // Sort descending
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  
  entries.forEach(([name, prob]) => {
    const isP = isParkinson(name);
    const pct = (prob * 100).toFixed(2);
    
    const row = document.createElement("div");
    row.className = "bar-row";
    
    row.innerHTML = `
      <div class="bar-header">
        <span class="bar-name">${name}</span>
        <span class="bar-pct">${pct}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${isP ? 'fill-parkinson' : 'fill-healthy'}" style="width: 0%"></div>
      </div>
    `;
    
    barsContainer.appendChild(row);
    
    // Animate fill width after append
    requestAnimationFrame(() => {
      setTimeout(() => {
        row.querySelector('.bar-fill').style.width = `${pct}%`;
      }, 50);
    });
  });
}

// ==========================================
// Main Inference Submission
// ==========================================
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = imageInput.files[0];
  if (!file) {
    setSystemStatus("System halted: Missing input file.", false);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  // UI Processing State
  predictButton.disabled = true;
  predictButton.classList.add("is-loading");
  previewWrap.classList.add("is-scanning");
  setSystemStatus("Running deep-learning inference...", true);

  // Reset output panel logic
  resultsPanel.className = "panel glass-panel output-panel"; // Remove states
  emptyResult.classList.add("hidden");
  activeResult.classList.add("hidden");

  try {
    const response = await fetch("/predict", {
      method: "POST",
      body: formData,
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Prediction request failed.");
    }
    
    renderMetaInfo(data.model); // update meta dynamically

    const result = data.result;
    const isP = isParkinson(result.predicted_class);
    
    // Apply State Styles
    resultsPanel.classList.add(isP ? "state-parkinson" : "state-healthy");
    
    // Inject Results
    resultIcon.innerHTML = isP ? ICON_PARKINSON : ICON_HEALTHY;
    mainDiagnosis.textContent = isP ? "Parkinson's Detected" : "Healthy Assessment";
    mainConfidence.textContent = `${(result.confidence * 100).toFixed(1)}%`;
    
    renderProbabilityBars(result.class_probabilities);
    
    // Reveal Active Results
    activeResult.classList.remove("hidden");
    setSystemStatus(`Inference complete. Time: ${new Date().toLocaleTimeString()}`, false);

  } catch (err) {
    console.error(err);
    setSystemStatus(`Error: ${err.message}`, false);
    emptyResult.innerHTML = `<p style="color:var(--parkinson)">Analysis failed: ${err.message}</p>`;
    emptyResult.classList.remove("hidden");
  } finally {
    predictButton.disabled = false;
    predictButton.classList.remove("is-loading");
    previewWrap.classList.remove("is-scanning");
  }
});
