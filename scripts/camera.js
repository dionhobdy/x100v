document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const cameraSelect = document.getElementById('cameraSelect');
    const capturePreview = document.getElementById('capturePreview');
    const previewImg = document.getElementById('previewImg');
    const cameraSection = document.querySelector('.camera-section');
    const captureBtn = document.getElementById('captureBtn');

    let capturedImage = null;
    let currentStream = null;

    // Initialize camera
    function initCamera(facingMode) {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }

        navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: facingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        })
        .then(stream => {
            currentStream = stream;
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                processFrame();
            };
        })
        .catch(err => {
            console.error('Camera error:', err);
            alert('Camera access denied. Please enable camera permissions.');
        });
    }

    // Camera selection
    cameraSelect.addEventListener('change', (e) => {
        initCamera(e.target.value);
    });

    // Handle screen orientation change
    function handleOrientationChange() {
        const isLandscape = window.innerWidth > window.innerHeight;
        if (isLandscape) {
            cameraSection.classList.add('landscape-mode');
        } else {
            cameraSection.classList.remove('landscape-mode');
        }
    }

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
    handleOrientationChange();

    // Initialize with rear camera
    initCamera('environment');

    // ------------------------------------------------------------
    // REAL FUJIFILM X100V SIMULATION PRESETS
    // ------------------------------------------------------------

    const presets = {
        velvia: {
            saturation: 1.45,
            shadowCurve: 1.4,
            highlightCurve: 1.2,
            colorMatrix: [
                1.10, -0.05, -0.05,
                -0.05, 1.05, 0.00,
                -0.05, 0.00, 1.10
            ],
            grain: 0.35,
            halation: 0.12
        },

        'classic-chrome': {
            saturation: 0.82,
            shadowCurve: 1.6,
            highlightCurve: 1.35,
            colorMatrix: [
                1.05, -0.08, 0.00,
                -0.05, 1.00, 0.05,
                0.02, -0.02, 1.00
            ],
            grain: 0.28,
            halation: 0.08
        },

        'classic-neg': {
            saturation: 0.75,
            shadowCurve: 1.8,
            highlightCurve: 1.25,
            colorMatrix: [
                1.08, -0.10, 0.02,
                -0.05, 1.02, 0.03,
                0.00, -0.03, 1.05
            ],
            grain: 0.32,
            halation: 0.10
        },

        astia: {
            saturation: 1.10,
            shadowCurve: 1.2,
            highlightCurve: 1.1,
            colorMatrix: [
                1.05, -0.03, -0.02,
                -0.02, 1.03, -0.01,
                -0.01, -0.02, 1.05
            ],
            grain: 0.20,
            halation: 0.06
        },

        'provia': {
            saturation: 1.00,
            shadowCurve: 1.1,
            highlightCurve: 1.1,
            colorMatrix: [
                1.02, -0.02, 0.00,
                -0.02, 1.02, 0.00,
                0.00, -0.01, 1.02
            ],
            grain: 0.18,
            halation: 0.05
        },

        'pro400h': {
            saturation: 1.12,
            shadowCurve: 1.0,
            highlightCurve: 1.05,
            colorMatrix: [
                1.05, -0.02, -0.03,
                -0.03, 1.03, 0.00,
                -0.02, 0.00, 1.05
            ],
            grain: 0.25,
            halation: 0.07
        }
    };

    let currentPreset = 'velvia';
    let settings = { ...presets.velvia };

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPreset = btn.dataset.preset;
            settings = { ...presets[currentPreset] };
        });
    });

    // ------------------------------------------------------------
    // FUJIFILM FILTER ENGINE
    // ------------------------------------------------------------

    function applyToneCurve(v, shadows, highlights) {
        v = Math.min(255, Math.max(0, v));
        const x = v / 255;
        const s = Math.pow(x, shadows);
        const h = 1 - Math.pow(1 - s, highlights);
        return Math.round(h * 255);
    }

    function applyColorMatrix(r, g, b, m) {
        return [
            r * m[0] + g * m[1] + b * m[2],
            r * m[3] + g * m[4] + b * m[5],
            r * m[6] + g * m[7] + b * m[8]
        ];
    }

    function applyHighlightRolloff(v) {
        v = Math.min(255, Math.max(0, v));
        const t = 215;
        if (v < t) return v;
        return t + (v - t) * 0.35;
    }

    function applyHalation(data, width, height, strength) {
        if (strength <= 0) return;

        const copy = new Uint8ClampedArray(data);
        const radius = 2;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                let rSum = 0, count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = (ny * width + nx) * 4;
                            rSum += copy[nIdx];
                            count++;
                        }
                    }
                }

                const baseR = copy[idx];
                const avgR = rSum / count;
                const glow = Math.max(0, (avgR - baseR)) * strength;

                data[idx] = Math.min(255, Math.max(0, data[idx] + glow));
            }
        }
    }

    function applyFujifilmFilter(imageData) {
        const data = imageData.data;
        const m = settings.colorMatrix;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // --- Color matrix ---
            [r, g, b] = applyColorMatrix(r, g, b, m);

            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));

            // --- Tone curve ---
            r = applyToneCurve(r, settings.shadowCurve, settings.highlightCurve);
            g = applyToneCurve(g, settings.shadowCurve, settings.highlightCurve);
            b = applyToneCurve(b, settings.shadowCurve, settings.highlightCurve);

            // --- Highlight rolloff ---
            r = applyHighlightRolloff(r);
            g = applyHighlightRolloff(g);
            b = applyHighlightRolloff(b);

            // --- Saturation ---
            const avg = (r + g + b) / 3;
            r = avg + (r - avg) * settings.saturation;
            g = avg + (g - avg) * settings.saturation;
            b = avg + (b - avg) * settings.saturation;

            r = Math.min(255, Math.max(0, r));
            g = Math.min(255, Math.max(0, g));
            b = Math.min(255, Math.max(0, b));

            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        // Halation
        if (settings.halation > 0) {
            applyHalation(data, imageData.width, imageData.height, settings.halation);
        }

        // Grain
        if (settings.grain > 0) {
            for (let i = 0; i < data.length; i += 4) {
                const noise = (Math.random() - 0.5) * settings.grain * 40;
                data[i]     = Math.min(255, Math.max(0, data[i]     + noise));
                data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
                data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
            }
        }

        return imageData;
    }

    // Process video frame
    function processFrame() {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const filtered = applyFujifilmFilter(imageData);
            ctx.putImageData(filtered, 0, 0);
        }
        requestAnimationFrame(processFrame);
    }

    // Capture photo
    document.getElementById('captureBtn').addEventListener('click', () => {
        capturedImage = canvas.toDataURL('image/jpeg', 0.95);
        previewImg.src = capturedImage;
        capturePreview.style.display = 'flex';
    });

    // Delete photo - return to camera
    document.getElementById('deleteBtn').addEventListener('click', () => {
        capturedImage = null;
        previewImg.src = '';
        capturePreview.style.display = 'none';
    });

    // Download photo
    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (!capturedImage) {
            alert('No photo to download');
            return;
        }
        const link = document.createElement('a');
        link.href = capturedImage;
        link.download = `x100v-${Date.now()}.jpg`;
        link.click();
    });

    // Settings collapse toggle
    document.querySelector('.settings-toggle').addEventListener('click', () => {
        const toggle = document.querySelector('.settings-toggle');
        const content = document.querySelector('.settings-content');
        toggle.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
        captureBtn.classList.toggle('hidden');
    });
});