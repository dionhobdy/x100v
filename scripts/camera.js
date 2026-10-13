document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const cameraSelect = document.getElementById('cameraSelect');
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

    // Camera color profiles are visual approximations, not manufacturer presets.
    const presets = {
        x100v: {
            saturation: 1.18, contrast: 1.08, warmth: 0.02,
            colorShift: [1.04, 1.0, 0.97], grain: 0.08
        },
        gameboy: {
            saturation: 1, contrast: 1.15, warmth: 0,
            colorShift: [1, 1, 1], grain: 0, pixelSize: 5,
            palette: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]]
        },
        tx20: {
            saturation: 1.28, contrast: 1.18, warmth: 0.01,
            colorShift: [1.04, 1.0, 0.96], grain: 0
        },
        polaroid: {
            saturation: 0.92, contrast: 0.88, warmth: 0.14,
            colorShift: [1.08, 1.01, 0.88], grain: 0.28, vignette: 0.24
        },
        a6400: {
            saturation: 1.04, contrast: 1.05, warmth: 0,
            colorShift: [1.02, 1.0, 0.99], grain: 0.02
        },
        zv1f: {
            saturation: 1.12, contrast: 1.06, warmth: 0.06,
            colorShift: [1.05, 1.01, 0.97], grain: 0
        },
    };

    let settings = { ...presets.x100v };

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            settings = { ...presets[btn.dataset.preset] };
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
        document.getElementById('grain').value = settings.grain;
        document.getElementById('satValue').textContent = settings.saturation.toFixed(1);
        document.getElementById('contValue').textContent = settings.contrast.toFixed(1);
        document.getElementById('warmValue').textContent = settings.warmth.toFixed(2);
        document.getElementById('grainValue').textContent = settings.grain.toFixed(1);
    }

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
        const redBlueShift = settings.colorShift
            ? (settings.colorShift[0] - settings.colorShift[2]) * 80
            : 0;
        const warmthHue = settings.warmth < 0 ? Math.abs(settings.warmth) * 90 : 0;
        const sepia = Math.min(1, Math.max(0, settings.warmth) * 1.5);
        return `saturate(${settings.saturation}) contrast(${settings.contrast}) sepia(${sepia}) hue-rotate(${redBlueShift + warmthHue}deg)`;
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
        if (settings.vignette) {
            const radius = Math.hypot(canvas.width / 2, canvas.height / 2);
            const gradient = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, radius * 0.2,
                canvas.width / 2, canvas.height / 2, radius
            );
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, `rgba(0, 0, 0, ${settings.vignette})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (settings.grain > 0) {
            ctx.globalAlpha = settings.grain * 0.35;
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
            if (settings.palette) {
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