document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const cameraSelect = document.getElementById('cameraSelect');
    const lensSelect = document.getElementById('lensSelect');
    const capturePreview = document.getElementById('capturePreview');
    const previewImg = document.getElementById('previewImg');
    const cameraSection = document.querySelector('.camera-section');
    const captureBtn = document.getElementById('captureBtn');
    const zoomControl = document.getElementById('zoom');
    const zoomValue = document.getElementById('zoomValue');
    const focusStatus = document.getElementById('focusStatus');
    const focusIndicator = document.createElement('div');
    focusIndicator.className = 'focus-indicator';
    focusIndicator.setAttribute('aria-hidden', 'true');
    cameraSection.appendChild(focusIndicator);
    
    let capturedImage = null;
    let capturedImageUrl = null;
    let currentStream = null;
    let cameraTrack = null;
    let nativeZoomActive = false;
    let zoomUpdateTimeout = null;
    let zoomRequestId = 0;
    let focusIndicatorTimeout = null;
    let currentZoom = 1;
    let focusPoint = { x: 0.5, y: 0.5 };
    let frameRequestId = null;
    let previewOpen = false;
    let gameboyCanvas = document.createElement('canvas');
    let gameboyContext = gameboyCanvas.getContext('2d', { willReadFrequently: true });
    let grainPattern = null;
    let lensCanvas = document.createElement('canvas');
    let lensContext = lensCanvas.getContext('2d', { willReadFrequently: true });
    let fisheyeSourceIndices = null;
    let fisheyeOutputImage = null;

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
            cameraTrack = stream.getVideoTracks()[0];
            configureZoomControl();
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                updateCanvasSize();
                startFrameLoop();
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

    function configureZoomControl() {
        let minZoom = 1;
        let maxZoom = 4;
        if (cameraTrack && typeof cameraTrack.getCapabilities === 'function') {
            const capabilities = cameraTrack.getCapabilities();
            if (capabilities.zoom) {
                minZoom = Math.max(1, capabilities.zoom.min);
                maxZoom = Math.max(1, capabilities.zoom.max);
            }
        }

        zoomControl.min = String(minZoom);
        zoomControl.max = String(maxZoom);
        currentZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom));
        zoomControl.value = String(currentZoom);
        zoomValue.textContent = `${currentZoom.toFixed(1)}x`;
        nativeZoomActive = false;
    }

    zoomControl.addEventListener('input', () => {
        currentZoom = parseFloat(zoomControl.value);
        zoomValue.textContent = `${currentZoom.toFixed(1)}x`;
        nativeZoomActive = false;
        zoomRequestId += 1;

        if (zoomUpdateTimeout) clearTimeout(zoomUpdateTimeout);
        zoomUpdateTimeout = setTimeout(applyNativeZoom, 120);
    });

    function applyNativeZoom() {
        zoomUpdateTimeout = null;
        if (!cameraTrack || typeof cameraTrack.getCapabilities !== 'function') return;

        const capabilities = cameraTrack.getCapabilities();
        if (!capabilities.zoom || typeof cameraTrack.applyConstraints !== 'function') return;

        const requestId = zoomRequestId;
        const requestedZoom = currentZoom;
        cameraTrack.applyConstraints({ advanced: [{ zoom: requestedZoom }] })
            .then(() => {
                if (requestId === zoomRequestId && requestedZoom === currentZoom) {
                    nativeZoomActive = true;
                }
            })
            .catch((error) => {
                if (requestId !== zoomRequestId) return;
                nativeZoomActive = false;
                console.warn('Native camera zoom unavailable; using digital zoom.', error);
                focusStatus.textContent = 'Using digital zoom. Tap the preview to focus.';
            });
    }

    canvas.addEventListener('pointerdown', (event) => {
        if (previewOpen || !cameraTrack) return;

        const bounds = canvas.getBoundingClientRect();
        focusPoint = {
            x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
            y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
        };

        focusIndicator.style.left = `${focusPoint.x * 100}%`;
        focusIndicator.style.top = `${focusPoint.y * 100}%`;
        focusIndicator.classList.add('visible');
        if (focusIndicatorTimeout) clearTimeout(focusIndicatorTimeout);
        focusIndicatorTimeout = setTimeout(() => {
            focusIndicator.classList.remove('visible');
        }, 900);

        requestFocus();
    });

    function requestFocus() {
        if (typeof cameraTrack.getCapabilities !== 'function' ||
            typeof cameraTrack.applyConstraints !== 'function') {
            focusStatus.textContent = 'Tap focus is not supported by this camera.';
            return;
        }

        const capabilities = cameraTrack.getCapabilities();
        const supportedFocusModes = capabilities.focusMode || [];
        const focusConstraints = [];
        focusConstraints.push({ pointsOfInterest: [focusPoint] });
        if (supportedFocusModes.includes('single-shot')) {
            focusConstraints.push({ focusMode: 'single-shot' });
        } else if (supportedFocusModes.includes('continuous')) {
            focusConstraints.push({ focusMode: 'continuous' });
        }

        if (focusConstraints.length === 1 && !capabilities.pointsOfInterest) {
            focusStatus.textContent = 'Tap focus is not supported; camera autofocus remains active.';
            return;
        }

        cameraTrack.applyConstraints({ advanced: focusConstraints })
            .then(() => {
                focusStatus.textContent = 'Autofocus requested.';
            })
            .catch((error) => {
                console.warn('Tap-to-focus request failed.', error);
                focusStatus.textContent = 'Tap focus is unavailable; camera autofocus remains active.';
            });
    }

    // Handle screen orientation change
    function handleOrientationChange() {
        const isLandscape = window.innerWidth > window.innerHeight;
        updateCanvasSize();
        if (isLandscape) {
            cameraSection.classList.add('landscape-mode');
            // Vertically center capture button
            captureBtn.style.position = 'fixed';
            captureBtn.style.right = '40px';
            captureBtn.style.top = '50%';
            captureBtn.style.transform = 'translateY(-50%)';
            captureBtn.style.zIndex = '30';
        } else {
            cameraSection.classList.remove('landscape-mode');
            // Reset capture button position
            captureBtn.style.position = '';
            captureBtn.style.right = '';
            captureBtn.style.top = '';
            captureBtn.style.transform = '';
            captureBtn.style.zIndex = '';
        }
    }

    // Listen for orientation changes
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
    
    // Call on initial load
    handleOrientationChange();

    // Initialize with rear camera
    initCamera('environment');

    // Named modes use each camera's built-in look families; the rendering remains an approximation.
    const simulations = {
        x100v: {
            label: 'Film Simulation',
            controls: [
                { id: 'exposureComp', label: 'Exposure Compensation (EV)', min: -2, max: 2, step: 0.1, value: 0 },
                { id: 'highlightTone', label: 'Highlight Tone', min: -2, max: 2, step: 1, value: 0 },
                { id: 'shadowTone', label: 'Shadow Tone', min: -2, max: 2, step: 1, value: 0 },
                { id: 'colorIntensity', label: 'Color', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'PROVIA / Standard', settings: { saturation: 1.05, contrast: 1.02 } },
                { name: 'Velvia / Vivid', settings: { saturation: 1.45, contrast: 1.16 } },
                { name: 'ASTIA / Soft', settings: { saturation: 1.08, contrast: 0.94, warmth: 0.04 } },
                { name: 'Classic Chrome', settings: { saturation: 0.78, contrast: 1.12, warmth: 0.04, hueRotate: -4 } }
            ]
        },
        gameboy: {
            label: 'Display Mode',
            controls: [
                { id: 'exposureComp', label: 'Exposure', min: -2, max: 2, step: 0.2, value: 0 },
                { id: 'contrastAdjust', label: 'Contrast', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'Color', settings: { saturation: 1.08, contrast: 1.05, pixelated: true } },
                { name: 'Original', settings: { saturation: 1, contrast: 1.1, pixelated: true, palette: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]] } },
                { name: 'Black/White', settings: { saturation: 0, contrast: 1.2, pixelated: true, palette: [[20, 20, 20], [85, 85, 85], [170, 170, 170], [245, 245, 245]] } }
            ]
        },
        tx20: {
            label: 'Picture Effect',
            controls: [
                { id: 'exposureComp', label: 'Exposure Compensation (EV)', min: -2, max: 2, step: 0.1, value: 0 },
                { id: 'colorIntensity', label: 'Color Intensity', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'Pop Color', settings: { saturation: 1.5, contrast: 1.08 } },
                { name: 'Toy Camera', settings: { saturation: 0.88, contrast: 1.08, warmth: 0.04, vignette: 0.3 } },
                { name: 'Retro Photo', settings: { saturation: 0.68, contrast: 0.92, sepia: 0.42 } },
                { name: 'High Contrast Monochrome', settings: { saturation: 0, contrast: 1.3 } }
            ]
        },
        'polaroid-now': {
            label: 'Film Type',
            controls: [
                { id: 'exposureComp', label: 'Exposure Compensation', min: -2, max: 2, step: 0.1, value: 0 },
                { id: 'warmthAdjust', label: 'Color Temperature', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'i-Type Color', settings: { saturation: 0.92, contrast: 0.92, warmth: 0.1, grain: 0.12, vignette: 0.16 } },
                { name: 'i-Type Black & White', settings: { saturation: 0, contrast: 1.08, grain: 0.12, vignette: 0.12 } },
                { name: '600 Color', settings: { saturation: 0.86, contrast: 0.96, warmth: 0.14, grain: 0.18, vignette: 0.2 } },
                { name: '600 Black & White', settings: { saturation: 0, contrast: 1.12, grain: 0.16, vignette: 0.16 } }
            ]
        },
        'polaroid-onestep': {
            label: 'Film Type',
            controls: [
                { id: 'exposureComp', label: 'Lighten / Darken', min: -2, max: 2, step: 1, value: 0 }
            ],
            modes: [
                { name: 'i-Type Color', settings: { saturation: 0.92, contrast: 0.92, warmth: 0.1, grain: 0.12, vignette: 0.16 } },
                { name: 'i-Type Black & White', settings: { saturation: 0, contrast: 1.08, grain: 0.12, vignette: 0.12 } },
                { name: '600 Color', settings: { saturation: 0.86, contrast: 0.96, warmth: 0.14, grain: 0.18, vignette: 0.2 } },
                { name: '600 Black & White', settings: { saturation: 0, contrast: 1.12, grain: 0.16, vignette: 0.16 } }
            ]
        },
        a6400: {
            label: 'Creative Style',
            controls: [
                { id: 'exposureComp', label: 'Exposure Compensation (EV)', min: -2, max: 2, step: 0.1, value: 0 },
                { id: 'highlightTone', label: 'Highlight Tone', min: -2, max: 2, step: 1, value: 0 },
                { id: 'shadowTone', label: 'Shadow Tone', min: -2, max: 2, step: 1, value: 0 },
                { id: 'colorIntensity', label: 'Saturation', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'Standard', settings: { saturation: 1.02, contrast: 1.02 } },
                { name: 'Vivid', settings: { saturation: 1.35, contrast: 1.1 } },
                { name: 'Neutral', settings: { saturation: 0.88, contrast: 0.92 } },
                { name: 'Clear', settings: { saturation: 1.05, contrast: 1.12 } },
                { name: 'Deep', settings: { saturation: 1.16, contrast: 1.18 } },
                { name: 'Light', settings: { saturation: 0.92, contrast: 0.84, brightness: 1.06 } },
                { name: 'Portrait', settings: { saturation: 0.96, contrast: 0.96, warmth: 0.04 } },
                { name: 'Landscape', settings: { saturation: 1.22, contrast: 1.08, hueRotate: -3 } },
                { name: 'Sunset', settings: { saturation: 1.15, contrast: 1.04, warmth: 0.16 } },
                { name: 'Night Scene', settings: { saturation: 0.92, contrast: 0.9, brightness: 1.04 } },
                { name: 'Autumn Leaves', settings: { saturation: 1.18, contrast: 1.04, warmth: 0.12 } },
                { name: 'Black & White', settings: { saturation: 0, contrast: 1.08 } },
                { name: 'Sepia', settings: { saturation: 0.55, contrast: 0.96, sepia: 0.8 } }
            ]
        },
        zv1f: {
            label: 'Creative Look',
            controls: [
                { id: 'exposureComp', label: 'Exposure Compensation (EV)', min: -2, max: 2, step: 0.1, value: 0 },
                { id: 'highlightTone', label: 'Highlights', min: -2, max: 2, step: 1, value: 0 },
                { id: 'shadowTone', label: 'Shadows', min: -2, max: 2, step: 1, value: 0 },
                { id: 'colorIntensity', label: 'Saturation', min: -4, max: 4, step: 1, value: 0 }
            ],
            modes: [
                { name: 'ST - Standard', settings: { saturation: 1.02, contrast: 1.02 } },
                { name: 'PT - Portrait', settings: { saturation: 0.96, contrast: 0.96, warmth: 0.04 } },
                { name: 'NT - Neutral', settings: { saturation: 0.88, contrast: 0.9 } },
                { name: 'VV - Vivid', settings: { saturation: 1.32, contrast: 1.08 } },
                { name: 'VV2 - Vivid 2', settings: { saturation: 1.42, contrast: 1.12 } },
                { name: 'FL - Film', settings: { saturation: 0.84, contrast: 0.88, warmth: 0.06 } },
                { name: 'IN - Instant', settings: { saturation: 0.92, contrast: 1.02, warmth: 0.08 } },
                { name: 'SH - Soft High-key', settings: { saturation: 0.86, contrast: 0.82, brightness: 1.08 } },
                { name: 'BW - Black & White', settings: { saturation: 0, contrast: 1.08 } },
                { name: 'SE - Sepia', settings: { saturation: 0.55, contrast: 0.92, sepia: 0.8 } }
            ]
        }
    };

    const cameraSetting = document.getElementById('cameraSetting');
    const cameraSettingLabel = document.getElementById('cameraSettingLabel');
    const cameraControls = document.getElementById('cameraControls');
    let selectedSimulation = 'x100v';
    let settings = {};
    const simulationControlValues = Object.fromEntries(
        Object.entries(simulations).map(([id, simulation]) => [
            id,
            Object.fromEntries(simulation.controls.map((control) => [control.id, control.value]))
        ])
    );

    function applySelectedMode() {
        const mode = simulations[selectedSimulation].modes[Number(cameraSetting.value)];
        settings = { ...mode.settings, ...simulationControlValues[selectedSimulation] };
    }

    function renderCameraControls() {
        const controls = simulations[selectedSimulation].controls;
        cameraControls.replaceChildren(...controls.map((control) => {
            const group = document.createElement('div');
            group.className = 'control-group';

            const label = document.createElement('label');
            label.htmlFor = `camera-control-${control.id}`;
            label.textContent = `${control.label}: `;

            const value = document.createElement('span');
            value.textContent = simulationControlValues[selectedSimulation][control.id];
            label.appendChild(value);

            const input = document.createElement('input');
            input.type = 'range';
            input.id = `camera-control-${control.id}`;
            input.min = String(control.min);
            input.max = String(control.max);
            input.step = String(control.step);
            input.value = String(simulationControlValues[selectedSimulation][control.id]);
            input.addEventListener('input', () => {
                const nextValue = Number(input.value);
                simulationControlValues[selectedSimulation][control.id] = nextValue;
                value.textContent = String(nextValue);
                applySelectedMode();
            });

            group.append(label, input);
            return group;
        }));
    }

    function showSimulation(simulationId) {
        selectedSimulation = simulationId;
        const simulation = simulations[simulationId];
        cameraSettingLabel.textContent = simulation.label;
        cameraSetting.replaceChildren(...simulation.modes.map((mode, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = mode.name;
            return option;
        }));
        cameraSetting.value = '0';
        renderCameraControls();
        applySelectedMode();
        document.querySelectorAll('.preset-btn').forEach((button) => {
            button.classList.toggle('active', button.dataset.preset === simulationId);
        });
    }

    document.querySelectorAll('.preset-btn').forEach((button) => {
        button.addEventListener('click', () => showSimulation(button.dataset.preset));
    });
    cameraSetting.addEventListener('change', applySelectedMode);
    showSimulation(selectedSimulation);
    let selectedLens = lensSelect.value;
    lensSelect.addEventListener('change', () => {
        selectedLens = lensSelect.value;
    });

    // Process video frame
    function updateCanvasSize() {
        if (!video.videoWidth || !video.videoHeight) return;

        const isLandscape = window.innerWidth > window.innerHeight;
        const longSide = Math.max(video.videoWidth, video.videoHeight);
        const shortSide = Math.min(video.videoWidth, video.videoHeight);
        const width = isLandscape ? longSide : shortSide;
        const height = isLandscape ? shortSide : longSide;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const gameboyWidth = Math.min(160, width);
        const gameboyHeight = Math.max(1, Math.round(gameboyWidth * height / width));
        if (gameboyCanvas.width !== gameboyWidth || gameboyCanvas.height !== gameboyHeight) {
            gameboyCanvas.width = gameboyWidth;
            gameboyCanvas.height = gameboyHeight;
        }

        updateLensCanvasSize(width, height);
    }

    function updateLensCanvasSize(width, height) {
        const lensWidth = Math.min(settings.pixelated ? 160 : 320, width);
        const lensHeight = Math.max(1, Math.round(lensWidth * height / width));
        if (lensCanvas.width !== lensWidth || lensCanvas.height !== lensHeight) {
            lensCanvas.width = lensWidth;
            lensCanvas.height = lensHeight;
            fisheyeSourceIndices = createFisheyeMap(lensWidth, lensHeight);
            fisheyeOutputImage = lensContext.createImageData(lensWidth, lensHeight);
        }
    }

    function createFisheyeMap(width, height) {
        const indices = new Uint32Array(width * height);
        const centerX = (width - 1) / 2;
        const centerY = (height - 1) / 2;

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const dx = (x - centerX) / Math.max(1, centerX);
                const dy = (y - centerY) / Math.max(1, centerY);
                const distance = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
                const sourceDistance = (2 / Math.PI) * Math.asin(distance);
                const scale = distance === 0 ? 1 : sourceDistance / distance;
                const sourceX = Math.max(0, Math.min(width - 1, Math.round(centerX + dx * scale * centerX)));
                const sourceY = Math.max(0, Math.min(height - 1, Math.round(centerY + dy * scale * centerY)));
                indices[y * width + x] = sourceY * width + sourceX;
            }
        }
        return indices;
    }

    function drawFisheyeFrame() {
        updateLensCanvasSize(canvas.width, canvas.height);
        const width = lensCanvas.width;
        const height = lensCanvas.height;
        lensContext.filter = getCameraFilter();
        drawCroppedVideo(lensContext, width, height);
        lensContext.filter = 'none';

        const sourceImage = lensContext.getImageData(0, 0, width, height);
        const sourcePixels = sourceImage.data;
        const warpedPixels = fisheyeOutputImage.data;

        for (let pixel = 0; pixel < fisheyeSourceIndices.length; pixel += 1) {
            const sourceOffset = fisheyeSourceIndices[pixel] * 4;
            const targetOffset = pixel * 4;
            let red = sourcePixels[sourceOffset];
            let green = sourcePixels[sourceOffset + 1];
            let blue = sourcePixels[sourceOffset + 2];

            if (settings.palette) {
                const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
                const color = settings.palette[Math.min(3, Math.floor(luminance / 64))];
                [red, green, blue] = color;
            }

            warpedPixels[targetOffset] = red;
            warpedPixels[targetOffset + 1] = green;
            warpedPixels[targetOffset + 2] = blue;
            warpedPixels[targetOffset + 3] = 255;
        }

        lensContext.putImageData(fisheyeOutputImage, 0, 0);
        ctx.imageSmoothingEnabled = !settings.pixelated;
        ctx.drawImage(lensCanvas, 0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
    }

    function drawCroppedVideo(targetContext, width, height) {
        const targetRatio = width / height;
        const sourceRatio = video.videoWidth / video.videoHeight;
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = video.videoWidth;
        let sourceHeight = video.videoHeight;

        if (sourceRatio > targetRatio) {
            sourceWidth = video.videoHeight * targetRatio;
            sourceX = (video.videoWidth - sourceWidth) / 2;
        } else {
            sourceHeight = video.videoWidth / targetRatio;
            sourceY = (video.videoHeight - sourceHeight) / 2;
        }

        const zoom = nativeZoomActive ? 1 : currentZoom;
        if (zoom > 1) {
            sourceWidth /= zoom;
            sourceHeight /= zoom;
            sourceX += (sourceWidth * zoom - sourceWidth) * focusPoint.x;
            sourceY += (sourceHeight * zoom - sourceHeight) * focusPoint.y;
        }
        sourceX = Math.min(video.videoWidth - sourceWidth, Math.max(0, sourceX));
        sourceY = Math.min(video.videoHeight - sourceHeight, Math.max(0, sourceY));

        targetContext.drawImage(
            video,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, width, height
        );
    }

    function getCameraFilter() {
        const warmthHue = ((settings.warmth || 0) + (settings.warmthAdjust || 0) * 0.025) * 45;
        const brightness = settings.brightness || 1;
        const exposure = 2 ** (settings.exposureComp || 0);
        const highlightContrast = 1 + (settings.highlightTone || 0) * 0.07;
        const shadowBrightness = 1 + (settings.shadowTone || 0) * 0.06;
        const color = Math.max(0, 1 + (settings.colorIntensity || 0) * 0.1);
        const contrast = Math.max(0, (settings.contrast || 1) * highlightContrast * (1 + (settings.contrastAdjust || 0) * 0.08));
        const retropia = selectedLens === 'retropia';
        return `saturate(${(settings.saturation ?? 1) * color * (retropia ? 0.82 : 1)}) contrast(${contrast * (retropia ? 0.96 : 1)}) brightness(${brightness * exposure * shadowBrightness}) grayscale(${settings.grayscale || 0}) sepia(${Math.min(1, (settings.sepia || 0) + (retropia ? 0.28 : 0))}) hue-rotate(${(settings.hueRotate || 0) + warmthHue + (retropia ? 5 : 0)}deg)`;
    }

    function getGrainPattern() {
        if (grainPattern) return grainPattern;

        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = 64;
        noiseCanvas.height = 64;
        const noiseContext = noiseCanvas.getContext('2d');
        const noise = noiseContext.createImageData(noiseCanvas.width, noiseCanvas.height);
        for (let i = 0; i < noise.data.length; i += 4) {
            const value = Math.random() * 255;
            noise.data[i] = value;
            noise.data[i + 1] = value;
            noise.data[i + 2] = value;
            noise.data[i + 3] = 255;
        }
        noiseContext.putImageData(noise, 0, 0);
        grainPattern = ctx.createPattern(noiseCanvas, 'repeat');
        return grainPattern;
    }

    function applyOverlays() {
        const vignette = Math.max(settings.vignette || 0, selectedLens === 'retropia' ? 0.22 : 0);
        if (vignette) {
            const radius = Math.hypot(canvas.width / 2, canvas.height / 2);
            const gradient = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, radius * 0.2,
                canvas.width / 2, canvas.height / 2, radius
            );
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, `rgba(0, 0, 0, ${vignette})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const grain = Math.max(settings.grain || 0, selectedLens === 'retropia' ? 0.16 : 0);
        if (grain > 0) {
            ctx.globalAlpha = grain * 0.35;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillStyle = getGrainPattern();
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function drawGameboyFrame() {
        gameboyContext.filter = getCameraFilter();
        drawCroppedVideo(gameboyContext, gameboyCanvas.width, gameboyCanvas.height);
        gameboyContext.filter = 'none';

        if (settings.palette) {
            const image = gameboyContext.getImageData(0, 0, gameboyCanvas.width, gameboyCanvas.height);
            const data = image.data;
            for (let i = 0; i < data.length; i += 4) {
                const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                const shade = Math.min(3, Math.floor(luminance / 64));
                const color = settings.palette[shade];
                data[i] = color[0];
                data[i + 1] = color[1];
                data[i + 2] = color[2];
            }
            gameboyContext.putImageData(image, 0, 0);
        }

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(gameboyCanvas, 0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
    }

    function startFrameLoop() {
        if (frameRequestId === null && !previewOpen) {
            if (typeof video.requestVideoFrameCallback === 'function') {
                frameRequestId = video.requestVideoFrameCallback(processFrame);
            } else {
                frameRequestId = requestAnimationFrame(processFrame);
            }
        }
    }

    function processFrame() {
        frameRequestId = null;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            if (selectedLens === 'fisheye') {
                drawFisheyeFrame();
            } else if (settings.pixelated) {
                drawGameboyFrame();
            } else {
                ctx.filter = getCameraFilter();
                drawCroppedVideo(ctx, canvas.width, canvas.height);
                ctx.filter = 'none';
            }
            applyOverlays();
        }
        startFrameLoop();
    }

    // Capture photo
    document.getElementById('captureBtn').addEventListener('click', () => {
        captureBtn.disabled = true;
        canvas.toBlob((blob) => {
            captureBtn.disabled = false;
            if (!blob) {
                console.error('Photo capture failed: canvas could not be encoded.');
                alert('Unable to capture photo. Please try again.');
                return;
            }

            capturedImage = blob;
            capturedImageUrl = URL.createObjectURL(blob);
            previewImg.src = capturedImageUrl;
            previewOpen = true;
            capturePreview.style.display = 'flex';
        }, 'image/jpeg', 0.95);
    });

    // Delete photo - return to camera
    document.getElementById('deleteBtn').addEventListener('click', () => {
        capturedImage = null;
        if (capturedImageUrl) URL.revokeObjectURL(capturedImageUrl);
        capturedImageUrl = null;
        previewImg.src = '';
        capturePreview.style.display = 'none';
        previewOpen = false;
        startFrameLoop();
    });

    // Download photo
    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (!capturedImage) {
            alert('No photo to download');
            return;
        }
        const link = document.createElement('a');
        link.href = capturedImageUrl;
        link.download = `x100v-${Date.now()}.jpg`;
        link.click();
        // Keep preview open after download
    });

    // Settings collapse toggle
    document.querySelector('.settings-toggle').addEventListener('click', () => {
        const toggle = document.querySelector('.settings-toggle');
        const content = document.querySelector('.settings-content');
        toggle.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
        
        // Hide/show capture button
        captureBtn.classList.toggle('hidden');
    });
});