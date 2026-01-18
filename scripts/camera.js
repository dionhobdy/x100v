        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const cameraSelect = document.getElementById('cameraSelect');
        const capturePreview = document.getElementById('capturePreview');
        const previewImg = document.getElementById('previewImg');
        
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

        // Initialize with rear camera
        initCamera('environment');

        // Film presets
        const presets = {
            velvia: { saturation: 1.4, contrast: 1.2, warmth: 0.1, colorShift: [1.1, 0.95, 0.85] },
            astia: { saturation: 1.1, contrast: 1.0, warmth: 0.05, colorShift: [1.05, 1.0, 0.95] },
            'pro400h': { saturation: 1.15, contrast: 0.9, warmth: 0.08, colorShift: [1.08, 0.98, 0.92] },
            'classic-chrome': { saturation: 1.0, contrast: 1.15, warmth: 0.03, colorShift: [1.02, 0.98, 1.0] }
        };

        let currentPreset = 'velvia';
        let settings = { ...presets.velvia, grain: 0.3 };

        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentPreset = btn.dataset.preset;
                const preset = presets[currentPreset];
                settings.saturation = preset.saturation;
                settings.contrast = preset.contrast;
                settings.warmth = preset.warmth;
                settings.colorShift = preset.colorShift;
                updateSliders();
            });
        });

        // Slider updates
        document.getElementById('saturation').addEventListener('input', (e) => {
            settings.saturation = parseFloat(e.target.value);
            document.getElementById('satValue').textContent = e.target.value;
        });

        document.getElementById('contrast').addEventListener('input', (e) => {
            settings.contrast = parseFloat(e.target.value);
            document.getElementById('contValue').textContent = e.target.value;
        });

        document.getElementById('warmth').addEventListener('input', (e) => {
            settings.warmth = parseFloat(e.target.value);
            document.getElementById('warmValue').textContent = e.target.value;
        });

        document.getElementById('grain').addEventListener('input', (e) => {
            settings.grain = parseFloat(e.target.value);
            document.getElementById('grainValue').textContent = e.target.value;
        });

        function updateSliders() {
            document.getElementById('saturation').value = settings.saturation;
            document.getElementById('contrast').value = settings.contrast;
            document.getElementById('warmth').value = settings.warmth;
            document.getElementById('satValue').textContent = settings.saturation.toFixed(1);
            document.getElementById('contValue').textContent = settings.contrast.toFixed(1);
            document.getElementById('warmValue').textContent = settings.warmth.toFixed(2);
        }

        // Apply Fujifilm filter
        function applyFujifilmFilter(imageData) {
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                let r = data[i];
                let g = data[i + 1];
                let b = data[i + 2];

                r = Math.min(255, r * (settings.colorShift?.[0] || 1));
                g = Math.min(255, g * (settings.colorShift?.[1] || 1));
                b = Math.min(255, b * (settings.colorShift?.[2] || 1));

                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const l = (max + min) / 2 / 255;
                let s = 0;
                let h = 0;

                if (max !== min) {
                    s = l < 0.5 ? (max - min) / (max + min) : (max - min) / (510 - max - min);
                    const delta = max - min;
                    if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
                    else if (max === g) h = (b - r) / delta + 2;
                    else h = (r - g) / delta + 4;
                    h /= 6;
                }

                s = Math.min(1, s * settings.saturation);

                const c = (1 - Math.abs(2 * l - 1)) * s;
                const x = c * (1 - Math.abs((h * 6) % 2 - 1));
                let r2 = 0, g2 = 0, b2 = 0;

                if (h < 1/6) { r2 = c; g2 = x; }
                else if (h < 2/6) { r2 = x; g2 = c; }
                else if (h < 3/6) { g2 = c; b2 = x; }
                else if (h < 4/6) { g2 = x; b2 = c; }
                else if (h < 5/6) { r2 = x; b2 = c; }
                else { r2 = c; b2 = x; }

                const m = l - c/2;
                r = Math.round((r2 + m) * 255);
                g = Math.round((g2 + m) * 255);
                b = Math.round((b2 + m) * 255);

                r = Math.min(255, Math.max(0, (r - 128) * settings.contrast + 128));
                g = Math.min(255, Math.max(0, (g - 128) * settings.contrast + 128));
                b = Math.min(255, Math.max(0, (b - 128) * settings.contrast + 128));

                r = Math.min(255, r + settings.warmth * 50);
                b = Math.max(0, b - settings.warmth * 30);

                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
            }

            if (settings.grain > 0) {
                for (let i = 0; i < data.length; i += 4) {
                    const noise = (Math.random() - 0.5) * settings.grain * 100;
                    data[i] = Math.min(255, Math.max(0, data[i] + noise));
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

        // Download photo
        document.getElementById('downloadBtn').addEventListener('click', () => {
            if (!capturedImage) {
                alert('Please capture a photo first');
                return;
            }
            const link = document.createElement('a');
            link.href = capturedImage;
            link.download = `x100v-${Date.now()}.jpg`;
            link.click();
            capturePreview.style.display = 'none';
        });

        // Settings collapse toggle
        document.querySelector('.settings-toggle').addEventListener('click', () => {
            const toggle = document.querySelector('.settings-toggle');
            const content = document.querySelector('.settings-content');
            toggle.classList.toggle('collapsed');
            content.classList.toggle('collapsed');
        });