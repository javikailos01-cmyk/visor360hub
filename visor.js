/* ==========================================================
   VISOR 360° - MOTOR DUAL (HTML5 VIDEO SCRUBBING + THREE.JS SPRITES)
   Optimizada para prevención de fugas de memoria y limpieza total
   ========================================================== */

window.currentProduct = null;
window.hotspotsAcumulados = [];

/* ==========================================================
   HELPER UNIFICADO DE COMUNICACIÓN IPC (ELECTRON)
   ========================================================== */
async function sincronizarHotspotsConElectron(productoId, hotspots) {
    if (!window.electronAPI || typeof window.electronAPI.guardarHotspots !== "function") {
        return { success: false, message: "Requiere entorno Electron." };
    }
    return await window.electronAPI.guardarHotspots({
        productoId: productoId,
        hotspots: hotspots
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const inicioScreen = document.getElementById("inicio-screen");
    const visorScreen = document.getElementById("visor-screen");
    const tarjetasContainer = document.getElementById("tarjetas-container");
    const gradientLine = document.getElementById("gradient-line");

    const container = document.querySelector(".visor-container");
    const canvasElement = document.querySelector(".visor-canvas");
    const loader = document.querySelector(".visor-loader");
    const hotspotsContainer = document.getElementById("hotspots-container");
    const productInfo = document.getElementById("product-info");
    const panelEditor = document.getElementById("panel-editor");

    const btnFullscreen = document.getElementById("btn-fullscreen");
    const btnBackCatalog = document.getElementById("btn-back-catalog");

    const modalOverlay = document.getElementById("hotspot-modal");
    const btnVolver360 = document.getElementById("btn-volver-360");
    const btnVolverCatalogoModal = document.getElementById("btn-volver-catalogo");
    const tituloEl = document.getElementById("modal-titulo");
    const descEl = document.getElementById("modal-descripcion");
    const imgContainer = document.getElementById("modal-img-container");

    let productsData = [];
    let hotspotDOMNodes = [];
    
    let renderer, scene, camera, cylinderMesh, productMaterial;
    let animationId = null;
    let lastTime = performance.now();

    // Variables de control para Three.js (Sprites)
    let isDragging = false;
    let startX = 0;
    let targetOffset = 0;
    let velocity = 0;
    let hasMoved = false;

    // Variables de control para Motor HTML5 Video (Scrubbing Fluido con Seek Lock)
    let videoElementoGlobal = null;
    let esVideoActivo = false;
    let targetProgress = 0;
    const videoSensitivity = 2.0;
    let videoIsDragging = false;
    let videoStartX = 0;

    let paginaActual = 1;
    const ITEMS_POR_PAGINA = 6;

    let modalRenderer = null;
    let modalAnimationId = null;
    let subVisorStack = [];
    let globalSubPointerMove = null;
    let globalSubPointerUp = null;

    let subScene = null;
    let subCamera = null;
    let subMesh = null;
    let subTexture = null;
    let subGeometry = null;
    let subShaderMat = null;

    let activeZoomInstances = [];

    canvasElement.addEventListener("dragstart", (e) => e.preventDefault());
    canvasElement.addEventListener("contextmenu", (e) => e.preventDefault());
    
    const visorHint = document.querySelector(".visor-hint");
    if (visorHint) {
        const hideHint = () => {
            visorHint.classList.add("fade-out");
            canvasElement.removeEventListener("pointerdown", hideHint);
        };
        canvasElement.addEventListener("pointerdown", hideHint);
    }

    if (container) {
        container.style.touchAction = "none";
    }

    function dispararAnimacionLinea() {
        if (gradientLine) {
            gradientLine.classList.remove("animar");
            void gradientLine.offsetWidth;
            gradientLine.classList.add("animar");
        }
    }

    dispararAnimacionLinea();

    if (btnFullscreen && container) {
        btnFullscreen.addEventListener("click", () => {
            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(err => console.error(err));
            } else {
                document.exitFullscreen();
            }
        });
    }

    async function cargarDatosLocales() {
        try {
            if (window.electronAPI && typeof window.electronAPI.leerProductos === "function") {
                productsData = await window.electronAPI.leerProductos();
            } else {
                const response = await fetch("productos.json");
                productsData = await response.json();
            }
            renderTarjetas();
        } catch (error) {
            console.error("Error al cargar los datos de productos:", error);
            if (loader) loader.textContent = "Error al cargar los datos.";
        }
    }

    /* ==========================================================
       GESTIÓN DE MEMORIA Y LIMPIEZA PROFUNDA DE VIDEO
       ========================================================== */
    function limpiarRecursosVideoGlobal() {
        if (videoElementoGlobal) {
            videoElementoGlobal.pause();
            videoElementoGlobal.removeAttribute('src');
            videoElementoGlobal.load(); // Fuerza al navegador a vaciar el búfer de video y liberar RAM/GPU
            videoElementoGlobal.remove();
            videoElementoGlobal = null;
        }
        window.onpointermove = null;
        window.onpointerup = null;
        esVideoActivo = false;
    }

    if (btnBackCatalog) {
        btnBackCatalog.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (typeof window.ocultarPanelAutonomo === "function") {
                window.ocultarPanelAutonomo();
            }

            if (document.fullscreenElement) {
                await document.exitFullscreen().catch(() => {});
            }

            visorScreen.classList.remove("active");
            visorScreen.classList.add("hidden");
            inicioScreen.classList.remove("hidden");
            inicioScreen.classList.add("active");

            if (panelEditor) panelEditor.classList.add("hidden");
            if (animationId) cancelAnimationFrame(animationId);
            
            limpiarRecursosVideoGlobal();
            
            await cargarDatosLocales();
            dispararAnimacionLinea();
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    let modoEditor = urlParams.get("modo") === "editor" || localStorage.getItem("modo_editor") === "true";

    if (modoEditor && panelEditor) {
        panelEditor.classList.remove("hidden");
        panelEditor.style.display = "block";
    } else if (panelEditor) {
        panelEditor.classList.add("hidden");
        panelEditor.style.display = "none";
    }

    const btnCerrarEditor = document.getElementById("btn-cerrar-editor");
    if (btnCerrarEditor && panelEditor) {
        btnCerrarEditor.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            modoEditor = false;
            localStorage.setItem("modo_editor", "false");
            panelEditor.classList.add("hidden");
            panelEditor.style.display = "none";
            const resultadoPaquete = document.getElementById("resultado-paquete");
            if (resultadoPaquete) resultadoPaquete.innerHTML = "";
        });
    }

    await cargarDatosLocales();

    function renderTarjetas() {
        tarjetasContainer.innerHTML = "";
        const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
        
        for (let i = 0; i < ITEMS_POR_PAGINA; i++) {
            const indiceReal = inicio + i;
            const product = productsData[indiceReal];
            const card = document.createElement("div");
            const esVacio = !product || !product.imagePath || product.imagePath === "";

            if (!esVacio) {
                const imgPortada = product.portada || 'assets/placeholder.webp';
                card.className = "card product-card";
                card.innerHTML = `
                    <div class="card-img-container">
                        <img src="${imgPortada}" alt="${product.titulo}">
                    </div>
                    <h3>${product.titulo}</h3>
                    <p>${product.descripcion}</p>
                    <button class="btn-ver">Ver en 360°</button>
                `;
                card.addEventListener("click", () => iniciarVisor(indiceReal));
            } else {
                card.className = "card product-card vacia";
                card.innerHTML = `
                    <div class="card-img-container placeholder-box">
                        <span class="lock-icon" style="font-size: 24px;">🚀</span>
                    </div>
                    <h3>Próximo Lanzamiento</h3>
                    <p>Muy pronto disponible</p>
                    <button class="btn-ver" style="background: #475569; cursor: not-allowed;">Próximamente</button>
                `;
            }
            tarjetasContainer.appendChild(card);
        }
        actualizarControlesPaginacion();
    }

    function actualizarControlesPaginacion() {
        let paginadorContainer = document.getElementById("paginador-container");
        if (!paginadorContainer) {
            paginadorContainer = document.createElement("div");
            paginadorContainer.id = "paginador-container";
        }

        if (paginadorContainer.nextSibling !== tarjetasContainer) {
            tarjetasContainer.parentNode.insertBefore(paginadorContainer, tarjetasContainer);
        }

        if (paginaActual === 1) {
            paginadorContainer.style.cssText = "display: flex; justify-content: flex-end; gap: 10px; margin-top: -12px; margin-right: 40px; width: 100%; z-index: 10; position: relative;";
            paginadorContainer.innerHTML = `
                <button id="btn-pagina-2" style="padding: 4px 8px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: bold; background: #1e293b; color: #99b8dd; border: 1px solid #38bdf8;">Página 2 ➔</button>
            `;
            document.getElementById("btn-pagina-2").onclick = () => {
                paginaActual = 2;
                renderTarjetas();
                window.scrollTo({ top: tarjetasContainer.offsetTop - 20, behavior: 'smooth' });
            };
        } else {
            paginadorContainer.style.cssText = "display: flex; justify-content: flex-start; gap: 10px; margin-top: -12px; margin-left: 40px; width: 100%; z-index: 10; position: relative;";
            paginadorContainer.innerHTML = `
                <button id="btn-pagina-1" style="padding: 4px 8px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: bold; background: #1e293b; color: #99b8dd; border: 1px solid #38bdf8;">⬅ Página 1</button>
            `;
            document.getElementById("btn-pagina-1").onclick = () => {
                paginaActual = 1;
                renderTarjetas();
                window.scrollTo({ top: tarjetasContainer.offsetTop - 20, behavior: 'smooth' });
            };
        }
    }

    async function iniciarVisor(index) {
        limpiarRecursosVideoGlobal();

        window.currentProduct = productsData[index];
        if (!window.currentProduct || !window.currentProduct.imagePath) return;
        
        inicioScreen.classList.remove("active");
        inicioScreen.classList.add("hidden");
        visorScreen.classList.remove("hidden");
        visorScreen.classList.add("active");

        if (typeof window.mostrarPanelAutonomo === "function") {
            window.mostrarPanelAutonomo();
        }

        if (loader) {
            loader.style.display = "block";
            loader.textContent = "Cargando visor 360°...";
        }

        const guardados = localStorage.getItem(`hotspots_${window.currentProduct.id}`);
        const jsonHotspots = window.currentProduct.hotspots || [];
        
        if (guardados) {
            window.hotspotsAcumulados = JSON.parse(guardados);
        } else {
            window.hotspotsAcumulados = jsonHotspots.map((h, idx) => ({
                ...h,
                id: h.id || `hotspot_${idx + 1}`
            }));
        }

        inicializarNodosHotspots();

        if (modoEditor) {
            const contadorElem = document.getElementById("contador-clicks");
            if (contadorElem) contadorElem.textContent = `Hotspots capturados: ${window.hotspotsAcumulados.length}`;
        }

        const assetPath = window.currentProduct.imagePath || "";
        const esVideoWebM = window.currentProduct.tipoAsset === "video" || assetPath.endsWith(".webm") || assetPath.endsWith(".mp4");
        esVideoActivo = esVideoWebM;

        if (esVideoWebM) {
            if (canvasElement) canvasElement.style.display = "none";
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }

            const video = document.createElement("video");
            video.id = "visor-video-temp";
            video.src = assetPath;
            video.crossOrigin = "anonymous";
            video.muted = true;
            video.playsInline = true;
            video.preload = "auto";
            video.style.cssText = "width: 100%; height: 100%; object-fit: contain; cursor: grab; touch-action: none; display: block; position: absolute; top: 0; left: 0;";
            
            container.insertBefore(video, container.firstChild);
            videoElementoGlobal = video;

            targetProgress = 0;

            // ==========================================
            // PATRÓN SEEK LOCK (OPTIMIZACIÓN DE SCRUBBING)
            // ==========================================
            let isSeeking = false;
            let pendingTime = null;

            function ejecutarSeek() {
                if (pendingTime === null) {
                    isSeeking = false;
                    return;
                }
                isSeeking = true;
                let target = pendingTime;
                pendingTime = null;
                video.currentTime = target;
            }

            video.addEventListener("seeked", () => {
                ejecutarSeek();
            });
            // ==========================================

            video.addEventListener("loadedmetadata", () => {
                if (loader) loader.style.display = "none";
                video.currentTime = 0;
            });

            if (video.readyState >= 1 && loader) {
                loader.style.display = "none";
            }

            const pointerDownVideo = (e) => {
                if (visorHint) visorHint.classList.add("fade-out");
                videoIsDragging = true;
                hasMoved = false;
                videoStartX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
                video.style.cursor = "grabbing";
                e.preventDefault();
            };

            const pointerMoveVideo = (e) => {
                if (!videoIsDragging || !video.duration) return;
                hasMoved = true;
                
                const x = e.clientX || (e.touches ? e.touches[0].clientX : 0);
                const deltaX = x - videoStartX;
                videoStartX = x;

                const rect = container.getBoundingClientRect();
                const factor = (deltaX / rect.width) * videoSensitivity;
                
                targetProgress -= factor;

                if (targetProgress > 1) targetProgress = 0;
                if (targetProgress < 0) targetProgress = 1;

                // Asignamos el tiempo al flujo controlado por Seek Lock
                pendingTime = targetProgress * video.duration;

                if (!isSeeking) {
                    ejecutarSeek();
                }

                actualizarHotspotsEnCilindro();
            };

            const pointerUpVideo = () => {
                videoIsDragging = false;
                video.style.cursor = "grab";
            };

            video.onpointerdown = pointerDownVideo;
            window.onpointermove = (e) => {
                if (esVideoActivo) pointerMoveVideo(e);
            };
            window.onpointerup = () => {
                if (esVideoActivo) pointerUpVideo();
            };

        } else {
            if (canvasElement) canvasElement.style.display = "block";

            if (!renderer) {
                scene = new THREE.Scene();
                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
                camera.position.z = 0.1;

                renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, powerPreference: "high-performance" });
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
                renderer.outputEncoding = THREE.sRGBEncoding;
            }

            targetOffset = 0;
            velocity = 0;

            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(assetPath, (texture) => {
                texture.generateMipmaps = false;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.encoding = THREE.sRGBEncoding;

                configurarMallaCilindrica(texture);
            });

            if (animationId) cancelAnimationFrame(animationId);
            animate(performance.now());
        }

        if (productInfo) {
            const numeroWhatsApp = "...xxx...";
            const nombreProducto = window.currentProduct.titulo || "producto";
            const mensajeTexto = encodeURIComponent(`Hola, estuve viendo el "${nombreProducto}" y me interesa...`);
            const linkWhatsApp = numeroWhatsApp.includes("xxx") ? "#" : `https://wa.me/${numeroWhatsApp}?text=${mensajeTexto}`;

            productInfo.innerHTML = `
                <h2>${nombreProducto}</h2>
                <a href="${linkWhatsApp}" target="_blank" class="btn-whatsapp-visor" ${numeroWhatsApp.includes("xxx") ? 'onclick="alert(\'Por favor, ingrese su número de WhatsApp.\'); return false;"' : ''}>
                    <span class="wa-icon">💬</span> Consultar por WhatsApp
                </a>
            `;
        }
    }

    function configurarMallaCilindrica(texture) {
        if (productMaterial) productMaterial.dispose();
        if (cylinderMesh) scene.remove(cylinderMesh);

        camera.position.set(0, 0, 0.1);

        const totalFrames = window.currentProduct.totalFrames || (window.currentProduct.columns ? 40 : 8);
        const columns = window.currentProduct.columns || 0;
        const rows = window.currentProduct.rows || 0;
        const frameAncho = window.currentProduct.frameWidth || (columns ? 640 : 500);
        const frameAlto = window.currentProduct.frameHeight || 960;

        const aspect = columns > 0 ? (frameAncho / frameAlto) : ((totalFrames * frameAncho) / frameAlto);
        const cylinderHeight = 3;
        const cylinderRadius = (aspect * cylinderHeight) / (2 * Math.PI);

        const geometry = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, cylinderHeight, 32, 1, true);
        const esGrilla = columns > 0 && rows > 0;

        productMaterial = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                uOffset: { value: 0.0 },
                uColumns: { value: columns },
                uRows: { value: rows },
                uTotalFrames: { value: totalFrames },
                uEsGrilla: { value: esGrilla ? 1.0 : 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D map;
                uniform float uOffset;
                uniform float uColumns;
                uniform float uRows;
                uniform float uTotalFrames;
                uniform float uEsGrilla;
                varying vec2 vUv;
                
                void main() {
                    if (uEsGrilla > 0.5) {
                        float frameIndex = floor(mod(uOffset * uTotalFrames, uTotalFrames));
                        if (frameIndex < 0.0) frameIndex += uTotalFrames;

                        float col = mod(frameIndex, uColumns);
                        float row = floor(frameIndex / uColumns);

                        vec2 gridUv = vec2(
                            (vUv.x + col) / uColumns,
                            (vUv.y + (uRows - 1.0 - row)) / uRows
                        );
                        gl_FragColor = texture2D(map, gridUv);
                    } else {
                        vec2 shiftedUv = vec2(fract((1.0 - vUv.x) + uOffset), vUv.y);
                        gl_FragColor = texture2D(map, shiftedUv);
                    }
                }
            `,
            side: THREE.BackSide
        });

        cylinderMesh = new THREE.Mesh(geometry, productMaterial);
        scene.add(cylinderMesh);

        if (loader) loader.style.display = "none";
    }

    canvasElement.addEventListener("pointerdown", (e) => {
        if (esVideoActivo) return;
        isDragging = true;
        startX = e.clientX;
        hasMoved = false;
    });

    window.addEventListener("pointermove", (e) => {
        if (esVideoActivo || !isDragging) return;
        if (Math.abs(e.clientX - startX) > 3) {
            hasMoved = true;
        }
        const deltaX = e.clientX - startX;
        startX = e.clientX;
        velocity = deltaX * 0.0004;
    });

    window.addEventListener("pointerup", () => { if (!esVideoActivo) isDragging = false; });
    window.addEventListener("pointercancel", () => { if (!esVideoActivo) isDragging = false; });

    function animate(timestamp) {
        if (esVideoActivo) return;
        animationId = requestAnimationFrame(animate);

        const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        if (!isDragging) {
            velocity *= Math.pow(0.05, deltaTime);
        }

        targetOffset -= velocity;

        if (productMaterial && productMaterial.uniforms && productMaterial.uniforms.uOffset) {
            productMaterial.uniforms.uOffset.value = targetOffset;
        }

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }

        actualizarHotspotsEnCilindro();
    }

    function actualizarHotspotsEnCilindro() {
        if (!window.currentProduct || !hotspotDOMNodes || hotspotDOMNodes.length === 0) return;
        
        const total = window.currentProduct.totalFrames || (window.currentProduct.columns ? 40 : 8);
        
        let normalized = 0;
        if (esVideoActivo) {
            normalized = targetProgress;
        } else {
            normalized = (-targetOffset) % 1;
            if (normalized < 0) normalized += 1;
        }
        const frameActual = Math.floor(normalized * total);

        hotspotDOMNodes.forEach(item => {
            const spot = item.spot;
            const hotspotEl = item.element;
            const parsedFrame = parseInt(spot.frame, 10);
            const spotIndex = (!isNaN(parsedFrame)) ? parsedFrame - 1 : 0; 

            const dist = Math.abs(spotIndex - frameActual);
            const distWrap = total - dist;
            const minDist = Math.min(dist, distWrap);

            if (minDist <= 1) {
                hotspotEl.style.display = "flex";
                hotspotEl.className = minDist === 0 ? "hotspot-punto exacto" : "hotspot-punto anticipacion";
                hotspotEl.style.left = spot.x;
                hotspotEl.style.top = spot.y;
            } else {
                hotspotEl.style.display = "none";
            }
        });
    }

    window.inicializarNodosHotspots = function() {
        hotspotsContainer.innerHTML = "";
        hotspotDOMNodes = [];

        if (!window.hotspotsAcumulados) return;

        window.hotspotsAcumulados.forEach((spot, index) => {
            const hotspotEl = document.createElement("div");
            hotspotEl.className = "hotspot-punto";
            hotspotEl.dataset.id = spot.id || `hotspot_${index + 1}`;
            hotspotEl.style.display = "none";
            hotspotEl.style.left = spot.x;
            hotspotEl.style.top = spot.y;

            hotspotEl.innerHTML = `
                <span class="hotspot-pulse"></span>
                <div class="hotspot-tooltip">
                    <h4>${spot.titulo || 'Detalle'}</h4>
                    <p>${spot.descripcion || spot.texto || ''}</p>
                </div>
            `;

            hotspotEl.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                abrirModalHotspot(spot);
            });
            
            hotspotEl.addEventListener("pointerdown", (e) => {
                if (!modoEditor) return;
                e.stopPropagation();
                e.preventDefault();

                const spotActual = spot;
                const elementoDom = hotspotEl;
                let isDraggingSpot = true;

                const onPointerMove = (moveEvent) => {
                    if (!isDraggingSpot) return;
                    const targetElForRect = esVideoActivo ? videoElementoGlobal : canvasElement;
                    if (!targetElForRect) return;
                    const rect = targetElForRect.getBoundingClientRect();
                    
                    let x = ((moveEvent.clientX - rect.left) / rect.width) * 100;
                    let y = ((moveEvent.clientY - rect.top) / rect.height) * 100;

                    x = Math.max(0, Math.min(100, x));
                    y = Math.max(0, Math.min(100, y));

                    spotActual.x = x.toFixed(1) + "%";
                    spotActual.y = y.toFixed(1) + "%";

                    elementoDom.style.left = spotActual.x;
                    elementoDom.style.top = spotActual.y;
                };

                const onPointerUp = () => {
                    isDraggingSpot = false;
                    window.removeEventListener("pointermove", onPointerMove);
                    window.removeEventListener("pointerup", onPointerUp);

                    if (window.currentProduct && window.currentProduct.id) {
                        localStorage.setItem(`hotspots_${window.currentProduct.id}`, JSON.stringify(window.hotspotsAcumulados));
                    }
                    if (typeof actualizarPanelEditor === "function") {
                        actualizarPanelEditor();
                    }
                };

                window.addEventListener("pointermove", onPointerMove);
                window.addEventListener("pointerup", onPointerUp);
            });

            hotspotsContainer.appendChild(hotspotEl);
            hotspotDOMNodes.push({ spot, element: hotspotEl });
        });
    }

    const visorAreaInteractiva = container;
    visorAreaInteractiva.addEventListener("click", (e) => {
        if (!modoEditor || !window.currentProduct) return;
        if (hasMoved) return;
        if (e.target.closest('.hotspot-punto') || e.target.closest('.visor-ui')) return;

        e.preventDefault();
        e.stopPropagation();

        const targetElForRect = esVideoActivo ? videoElementoGlobal : canvasElement;
        if (!targetElForRect) return;
        const rect = targetElForRect.getBoundingClientRect();
        
        const xPercent = ((e.clientX - rect.left) / rect.width * 100).toFixed(1) + "%";
        const yPercent = ((e.clientY - rect.top) / rect.height * 100).toFixed(1) + "%";

        const total = window.currentProduct.totalFrames || (window.currentProduct.columns ? 40 : 8);
        let normalized = esVideoActivo ? targetProgress : ((-targetOffset) % 1);
        if (normalized < 0) normalized += 1;
        const frameReal = Math.floor(normalized * total) + 1;

        const hotspotId = 'hotspot_' + Date.now();
        const nuevoHotspot = {
            "id": hotspotId,
            "vista": window.currentProduct.titulo,
            "frame": frameReal,
            "x": xPercent,
            "y": yPercent,
            "titulo": "Nuevo Componente",
            "descripcion": "Descripción detallada del componente.",
            "imagenes": [
                `assets/${window.currentProduct.id}/${hotspotId}/foto-01.webp`
            ]
        };

        window.hotspotsAcumulados.push(nuevoHotspot);
        localStorage.setItem(`hotspots_${window.currentProduct.id}`, JSON.stringify(window.hotspotsAcumulados));

        const contadorElem = document.getElementById("contador-clicks");
        if (contadorElem) contadorElem.textContent = `Hotspots capturados: ${window.hotspotsAcumulados.length}`;

        window.inicializarNodosHotspots();
        actualizarHotspotsEnCilindro();

        const resultadoPaquete = document.getElementById("resultado-paquete");
        if (resultadoPaquete) {
            resultadoPaquete.innerHTML = `<span style="color: #00ffcc;">¡Capturado! ID: ${hotspotId} (Frame ${frameReal})</span>`;
        }
    });

    const btnResetearEditor = document.getElementById("btn-resetear-editor");
    if (btnResetearEditor) {
        btnResetearEditor.textContent = "Deshacer Último";
        btnResetearEditor.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!window.currentProduct || !window.hotspotsAcumulados || window.hotspotsAcumulados.length === 0) return;

            const hotspotEliminado = window.hotspotsAcumulados.pop();
            localStorage.setItem(`hotspots_${window.currentProduct.id}`, JSON.stringify(window.hotspotsAcumulados));
            
            const contadorElem = document.getElementById("contador-clicks");
            if (contadorElem) contadorElem.textContent = `Hotspots capturados: ${window.hotspotsAcumulados.length}`;
            
            window.inicializarNodosHotspots();
            actualizarHotspotsEnCilindro();

            const resultadoPaquete = document.getElementById("resultado-paquete");
            if (resultadoPaquete) {
                resultadoPaquete.innerHTML = `<span style="color: #fbbf24;">↩ Hotspot eliminado (${hotspotEliminado.id}).</span>`;
            }
        });
    }

    function resetearZoomGlobal() {
        activeZoomInstances.forEach((resetFn) => {
            if (typeof resetFn === "function") {
                try { resetFn(); } catch (error) {}
            }
        });
        activeZoomInstances = [];
    }

    function limpiarRecursosSubVisor() {
        if (modalAnimationId) {
            cancelAnimationFrame(modalAnimationId);
            modalAnimationId = null;
        }
        if (globalSubPointerMove) {
            window.removeEventListener("pointermove", globalSubPointerMove);
            globalSubPointerMove = null;
        }
        if (globalSubPointerUp) {
            window.removeEventListener("pointerup", globalSubPointerUp);
            globalSubPointerUp = null;
        }
        if (subMesh && subScene) {
            subScene.remove(subMesh);
            subMesh = null;
        }
        if (subTexture) {
            subTexture.dispose();
            subTexture = null;
        }
        if (subGeometry) {
            subGeometry.dispose();
            subGeometry = null;
        }
        if (subShaderMat) {
            subShaderMat.dispose();
            subShaderMat = null;
        }
        subScene = null;
        subCamera = null;

        if (modalRenderer) {
            modalRenderer.dispose();
            modalRenderer = null;
        }
    }

    function cerrarModalHotspot() {
        if (!modalOverlay) return;
        modalOverlay.classList.add("hidden");
        limpiarRecursosSubVisor();
        if (imgContainer) imgContainer.innerHTML = "";
        subVisorStack = [];
        resetearZoomGlobal();
        if (visorScreen && visorScreen.classList.contains("active") && window.currentProduct && !esVideoActivo) {
            lastTime = performance.now();
        }
    }

    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) cerrarModalHotspot();
        });
    }

    function abrirModalHotspot(spot) {
        if (!modalOverlay) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        subVisorStack = [spot];
        renderizarContenidoModal(spot);
        modalOverlay.classList.remove("hidden");
    }

    function renderizarContenidoModal(spot) {
        resetearZoomGlobal();
        limpiarRecursosSubVisor();

        if (tituloEl) tituloEl.textContent = spot.titulo || "Detalle del Componente";

        if (descEl) {
            const textoDesc = spot.descripcion || spot.texto || "";
            if (textoDesc) {
                descEl.textContent = textoDesc;
                descEl.style.display = "block";
            } else {
                descEl.style.display = "none";
            }
        }

        if (btnVolver360) {
            btnVolver360.innerHTML = "360 principal";
            btnVolver360.style.display = "inline-block";
            btnVolver360.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cerrarModalHotspot();
            };
        }

        if (btnVolverCatalogoModal) {
            btnVolverCatalogoModal.innerHTML = "catalogo";
            btnVolverCatalogoModal.style.display = "inline-block";
            btnVolverCatalogoModal.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (typeof window.ocultarPanelAutonomo === "function") {
                    window.ocultarPanelAutonomo();
                }

                if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
                cerrarModalHotspot();
                visorScreen.classList.remove("active");
                visorScreen.classList.add("hidden");
                inicioScreen.classList.remove("hidden");
                inicioScreen.classList.add("active");
                if (panelEditor) panelEditor.classList.add("hidden");
                if (animationId) cancelAnimationFrame(animationId);
                
                limpiarRecursosVideoGlobal();

                await cargarDatosLocales();
                dispararAnimacionLinea();
            };
        }

        if (imgContainer) {
            imgContainer.innerHTML = "";
            let listaImagenes = [];
            if (spot.imagenes) {
                const imgs = Array.isArray(spot.imagenes) ? spot.imagenes : [spot.imagenes];
                listaImagenes.push(...imgs);
            }
            if (spot.imagen) {
                const imgs = Array.isArray(spot.imagen) ? spot.imagen : [spot.imagen];
                listaImagenes.push(...imgs);
            }
            if (spot.imagenEstatica) listaImagenes.push(spot.imagenEstatica);

            Object.keys(spot).forEach(key => {
                const val = spot[key];
                if (typeof val === "string" && val.trim() !== "") {
                    const esRutaImagen = val.includes(".webp") || val.includes(".jpg") || val.includes(".png") || val.includes(".jpeg");
                    const esClaveFoto = key.toLowerCase().startsWith("foto") || key.toLowerCase().startsWith("img") || key.toLowerCase().startsWith("imagen");
                    if ((esRutaImagen || esClaveFoto) && key !== "sub360" && !listaImagenes.includes(val)) {
                        listaImagenes.push(val);
                    }
                }
            });

            if (listaImagenes.length === 0 && !spot.sub360) {
                listaImagenes = ["assets/placeholder.webp"];
            }

            listaImagenes.forEach((rutaImagen, indexImg) => {
                if (typeof rutaImagen !== "string") return;

                const wrapperDiv = document.createElement("div");
                wrapperDiv.className = "modal-img-wrapper";
                wrapperDiv.style.cssText = "position: relative; display: block; width: 100%; text-align: center; margin-bottom: 20px;";

                const imgElement = document.createElement("img");
                imgElement.src = rutaImagen.trim();
                imgElement.alt = spot.titulo || "Detalle";
                imgElement.className = "modal-zoom-img";
                imgElement.draggable = false;
                imgElement.style.cssText = "max-width: 100%; max-height: 50vh; width: auto; height: auto; object-fit: contain; display: block; margin: 0 auto; border-radius: 8px;";

                wrapperDiv.appendChild(imgElement);

                const esGatewayFoto = spot.sub360 && (indexImg === 0 || spot.sub360Index === indexImg);
                if (esGatewayFoto) {
                    const gatewayBadge = document.createElement("div");
                    gatewayBadge.className = "gateway-indicator";
                    gatewayBadge.innerHTML = `<span>🔄 Ver Sub-360°</span>`;
                    gatewayBadge.style.cssText = "position: absolute; bottom: 15px; right: 15px; background: rgba(0, 0, 0, 0.75); color: #00ffcc; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; cursor: pointer; border: 1px solid #00ffcc; z-index: 10;";
                    
                    gatewayBadge.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        activarSubVisorEnModal(spot.sub360);
                    });
                    wrapperDiv.appendChild(gatewayBadge);
                    imgElement.style.cursor = "pointer";
                    imgElement.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        activarSubVisorEnModal(spot.sub360);
                    });
                }
                imgContainer.appendChild(wrapperDiv);
            });
        }
    }

    function activarSubVisorEnModal(subConfig) {
        if (!subConfig || !imgContainer) return;
        resetearZoomGlobal();
        limpiarRecursosSubVisor();

        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (btnVolver360) {
            btnVolver360.innerHTML = "volver a fotos";
            btnVolver360.style.display = "inline-block";
            btnVolver360.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                renderizarContenidoModal(subVisorStack[subVisorStack.length - 1]);
            };
        }

        if (btnVolverCatalogoModal) {
            btnVolverCatalogoModal.innerHTML = "360 principal";
            btnVolverCatalogoModal.style.display = "inline-block";
            btnVolverCatalogoModal.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cerrarModalHotspot();
            };
        }

        imgContainer.innerHTML = "";

        const subWrapper = document.createElement("div");
        subWrapper.className = "modal-sub360-wrapper";
        subWrapper.style.cssText = "width: 100%; display: flex; justify-content: center; align-items: center; position: relative; margin: 0 auto; max-height: 90vh;";

        const subCanvas = document.createElement("canvas");
        subCanvas.className = "modal-sub360-canvas";
        subCanvas.style.cssText = "max-width: 100%; max-height: 55vh; width: 100%; height: auto; object-fit: contain; touch-action: none; display: block; margin: auto; border-radius: 8px;";

        subCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
        subCanvas.addEventListener("dragstart", (e) => e.preventDefault());
        subWrapper.appendChild(subCanvas);
        imgContainer.appendChild(subWrapper);

        subScene = new THREE.Scene();
        const subAncho = subConfig.frameWidth || 640;
        const subAlto = subConfig.frameHeight || 960;
        subCamera = new THREE.PerspectiveCamera(45, subAncho / subAlto, 0.1, 100);
        subCamera.position.z = 5;

        modalRenderer = new THREE.WebGLRenderer({ canvas: subCanvas, alpha: true, antialias: true });
        modalRenderer.setPixelRatio(window.devicePixelRatio);
        modalRenderer.setSize(subAncho, subAlto);

        const imgSub = new Image();
        imgSub.onload = () => {
            if (!subScene) return; 
            subTexture = new THREE.CanvasTexture(imgSub);
            subTexture.generateMipmaps = false;
            subTexture.minFilter = THREE.LinearFilter;
            subTexture.magFilter = THREE.LinearFilter;

            const aspect = subAncho / subAlto;
            const scale = 5;
            subGeometry = new THREE.PlaneGeometry(scale * aspect, scale);
            
            const subColumns = subConfig.columns || 5;
            const subTotalFrames = subConfig.totalFrames || 40;
            const subRows = Math.ceil(subTotalFrames / subColumns);

            subShaderMat = new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: subTexture },
                    offsetA: { value: new THREE.Vector2(0, 0) },
                    offsetB: { value: new THREE.Vector2(0, 0) },
                    repeat: { value: new THREE.Vector2(1 / subColumns, 1 / subRows) },
                    mixFactor: { value: 0.0 },
                    opacity: { value: 1.0 },
                    colorTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D map;
                    uniform vec2 offsetA;
                    uniform vec2 offsetB;
                    uniform vec2 repeat;
                    uniform float mixFactor;
                    uniform float opacity;
                    uniform vec3 colorTint;
                    varying vec2 vUv;
                    void main() {
                        vec2 uvA = vUv * repeat + offsetA;
                        vec2 uvB = vUv * repeat + offsetB;
                        vec4 texA = texture2D(map, uvA);
                        vec4 texB = texture2D(map, uvB);
                        float cleanMix = smoothstep(0.05, 0.15, mixFactor);
                        vec4 finalColor = mix(texA, texB, cleanMix);
                        finalColor.rgb *= colorTint;
                        finalColor.a *= opacity;
                        gl_FragColor = finalColor;
                    }
                `,
                transparent: true
            });

            subMesh = new THREE.Mesh(subGeometry, subShaderMat);
            subScene.add(subMesh);

            let subFrame = 0;
            let targetSubFrame = 0;
            let targetSubVelocity = 0;
            let isSubDragging = false;
            let subStartX = 0;

            subCanvas.addEventListener("pointerdown", (e) => {
                isSubDragging = true;
                subStartX = e.clientX;
                e.preventDefault();
            });

            globalSubPointerMove = (e) => {
                if (!isSubDragging) return;
                const deltaX = e.clientX - subStartX;
                subStartX = e.clientX;
                targetSubVelocity = deltaX * 0.21;
            };

            globalSubPointerUp = () => { isSubDragging = false; };

            window.addEventListener("pointermove", globalSubPointerMove);
            window.addEventListener("pointerup", globalSubPointerUp);

            let lastSubTime = performance.now();
            function animateSub(timestamp = performance.now()) {
                if (!modalRenderer || !subScene || !subCamera) return;

                const rawDelta = (timestamp - lastSubTime) / 1000;
                const deltaTime = Math.min(rawDelta, 0.1);
                lastSubTime = timestamp;

                targetSubFrame -= targetSubVelocity;
                targetSubVelocity *= Math.pow(0.75, deltaTime * 60);
                subFrame += (targetSubFrame - subFrame) * 0.12;

                if (!isSubDragging && Math.abs(targetSubVelocity) < 0.005) {
                    targetSubVelocity = 0;
                    if (Math.abs(targetSubFrame - subFrame) < 0.02) {
                        subFrame = Math.round(subFrame);
                        targetSubFrame = subFrame;
                    }
                }

                let normFloat = subFrame % subTotalFrames;
                if (normFloat < 0) normFloat += subTotalFrames;

                const floorF = Math.floor(normFloat);
                const dec = normFloat - floorF;
                const fA = floorF % subTotalFrames;
                const fB = (floorF + 1) % subTotalFrames;

                const cA = fA % subColumns;
                const rA = Math.floor(fA / subColumns);
                const cB = fB % subColumns;
                const rB = Math.floor(fB / subColumns);

                if (subShaderMat && subShaderMat.uniforms) {
                    subShaderMat.uniforms.offsetA.value.set(cA / subColumns, 1.0 - (rA + 1) / subRows);
                    subShaderMat.uniforms.offsetB.value.set(cB / subColumns, 1.0 - (rB + 1) / subRows);
                    subShaderMat.uniforms.mixFactor.value = dec;
                }

                modalRenderer.render(subScene, subCamera);
                modalAnimationId = requestAnimationFrame(animateSub);
            }
            animateSub();
        };
        imgSub.src = subConfig.imagePath;
    }

    window.addEventListener("resize", () => {
        if (!camera || !renderer || esVideoActivo) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    if (panelEditor) panelEditor.classList.add("hidden");
    if (modoEditor && panelEditor) panelEditor.classList.remove("hidden");
});

/* ==========================================================
   BLOQUE LEGACY - EDITOR ANTIGUO (Encapsulado y Corregido)
   ========================================================== */
(function inicializarLegacyEditor() {
    const btnGuardarHotspots = document.getElementById("btn-guardar-hotspots");
    if (btnGuardarHotspots) {
        btnGuardarHotspots.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!window.currentProduct) return;

            btnGuardarHotspots.disabled = true;
            const textoOriginal = btnGuardarHotspots.textContent;
            btnGuardarHotspots.textContent = "Guardando...";

            try {
                const resultado = await sincronizarHotspotsConElectron(
                    window.currentProduct.id, 
                    window.hotspotsAcumulados
                );
                
                const resultadoPaquete = document.getElementById("resultado-paquete");
                if (resultado && resultado.success) {
                    window.currentProduct.hotspots = JSON.parse(JSON.stringify(window.hotspotsAcumulados));
                    localStorage.removeItem(`hotspots_${window.currentProduct.id}`);
                    if (resultadoPaquete) {
                        resultadoPaquete.innerHTML = `<span style="color:#00ffcc;">✓ Hotspots guardados correctamente</span>`;
                    }
                } else {
                    if (resultadoPaquete) {
                        resultadoPaquete.innerHTML = `<span style="color:#f87171;">Error al guardar: ${resultado?.message || 'Desconocido'}</span>`;
                    }
                }
            } catch (error) {
                console.error("Error al guardar hotspots:", error);
                const resultadoPaquete = document.getElementById("resultado-paquete");
                if (resultadoPaquete) {
                    resultadoPaquete.innerHTML = `<span style="color:#f87171;">Error crítico de comunicación.</span>`;
                }
            } finally {
                btnGuardarHotspots.disabled = false;
                btnGuardarHotspots.textContent = textoOriginal;
            }
        });
    }
})();

/* ==========================================================
   PANEL FLOTANTE UNIFICADO - EDITOR DE HOTSPOTS (ELECTRON)
   ========================================================== */

const esEntornoElectronReal = (typeof window.electronAPI !== "undefined") || 
                             (navigator.userAgent.toLowerCase().indexOf('electron') > -1);

if (esEntornoElectronReal) {
    let isDraggingPanel = false;
    let panelStartX, panelStartY;

    window.mostrarPanelAutonomo = function() {
        let panelFlotante = document.getElementById("panel-hotspots-autonomo");
        if (!panelFlotante) {
            panelFlotante = document.createElement("div");
            panelFlotante.id = "panel-hotspots-autonomo";
            panelFlotante.style.cssText = `
                position: fixed !important;
                bottom: 20px !important;
                right: 20px !important;
                width: 340px !important;
                background: #0f172a !important;
                border: 2px solid #38bdf8 !important;
                border-radius: 8px !important;
                padding: 15px !important;
                color: white !important;
                font-family: sans-serif !important;
                z-index: 2147483647 !important;
                box-shadow: 0 10px 25px rgba(0,0,0,0.9) !important;
                display: block !important;
                user-select: none !important;
            `;
            document.body.appendChild(panelFlotante);

            panelFlotante.addEventListener("mousedown", (e) => {
                if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL"].includes(e.target.tagName)) return;
                
                isDraggingPanel = true;
                const rect = panelFlotante.getBoundingClientRect();
                
                panelFlotante.style.bottom = "auto";
                panelFlotante.style.right = "auto";
                panelFlotante.style.left = rect.left + "px";
                panelFlotante.style.top = rect.top + "px";
                
                panelStartX = e.clientX - rect.left;
                panelStartY = e.clientY - rect.top;
                panelFlotante.style.cursor = "grabbing";
            });

            document.addEventListener("mousemove", (e) => {
                if (!isDraggingPanel) return;
                e.preventDefault();
                
                let x = e.clientX - panelStartX;
                let y = e.clientY - panelStartY;
                
                panelFlotante.style.left = `${x}px`;
                panelFlotante.style.top = `${y}px`;
            });

            document.addEventListener("mouseup", () => {
                if (isDraggingPanel) {
                    isDraggingPanel = false;
                    if (panelFlotante) panelFlotante.style.cursor = "default";
                }
            });
        } else {
            panelFlotante.style.display = "block";
        }
        
        if (window.currentProduct) {
            const guardadosLocal = localStorage.getItem(`hotspots_${window.currentProduct.id}`);
            if (guardadosLocal) {
                try {
                    window.hotspotsAcumulados = JSON.parse(guardadosLocal);
                } catch(e) {}
            } else {
                window.hotspotsAcumulados = JSON.parse(JSON.stringify(window.currentProduct.hotspots || []));
            }
        }
        
        actualizarPanelEditor();
    };

    window.ocultarPanelAutonomo = function() {
        const panelFlotante = document.getElementById("panel-hotspots-autonomo");
        if (panelFlotante) {
            panelFlotante.style.display = "none";
        }
    };

    function actualizarPanelEditor() {
        const panel = document.getElementById("panel-hotspots-autonomo");
        if (!panel || panel.style.display === "none") return;
        
        let lista = window.hotspotsAcumulados || [];
        
        let htmlItems = "";
        if (lista.length === 0) {
            htmlItems = '<div style="color: #94a3b8; text-align: center; padding: 12px; font-size: 12px;">Haz clic en el visor para añadir puntos hotspot.</div>';
        } else {
            lista.forEach((spot, index) => {
                htmlItems += `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.07); padding: 6px 10px; border-radius: 4px; margin-bottom: 5px; font-size: 12px; border: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong style="color: #38bdf8;">#${index + 1}</strong> 
                            <span style="color: #cbd5e1; margin-left: 5px;">(Frame ${spot.frame})</span>
                            <div style="font-size: 10px; color: #94a3b8; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${spot.titulo || 'Sin título'}</div>
                        </div>
                        <button type="button" onclick="window.borrarSpotGlobal('${spot.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">Eliminar</button>
                    </div>
                `;
            });
        }

        panel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-bottom: 1px solid rgba(56,189,248,0.3); padding-bottom: 6px;">
                <span>Editor de Hotspots</span>
                <span style="background: rgba(56,189,248,0.2); padding: 2px 6px; border-radius: 4px; font-size: 11px;">Total: ${lista.length}</span>
            </div>
            <div style="max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px;">
                ${htmlItems}
            </div>
            <div id="editor-feedback" style="font-size: 11px; margin-bottom: 8px; text-align: center; color: #00ffcc; min-height: 15px;"></div>
            <button type="button" id="btn-confirmar-cambios" style="width: 100%; background: #10b981; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">Confirmar Cambios</button>
        `;

        const btnConfirmar = document.getElementById("btn-confirmar-cambios");
        if (btnConfirmar) {
            btnConfirmar.onclick = async () => {
                await ejecutarGuardadoDefinitivo();
            };
        }
    }

    window.borrarSpotGlobal = function(idObjetivo) {
        if (!window.hotspotsAcumulados) return;
        
        window.hotspotsAcumulados = window.hotspotsAcumulados.filter(h => h.id !== idObjetivo);
        
        if (window.currentProduct && window.currentProduct.id) {
            localStorage.setItem(`hotspots_${window.currentProduct.id}`, JSON.stringify(window.hotspotsAcumulados));
        }
        
        if (typeof inicializarNodosHotspots === 'function') inicializarNodosHotspots();
        actualizarPanelEditor();

        const feedback = document.getElementById("editor-feedback");
        if (feedback) feedback.innerHTML = `<span style="color: #fbbf24;">Punto eliminado de la lista de trabajo.</span>`;
    };

    async function ejecutarGuardadoDefinitivo() {
        const btnConfirmar = document.getElementById("btn-confirmar-cambios");
        const feedback = document.getElementById("editor-feedback");
        
        if (!window.currentProduct) return;

        if (btnConfirmar) {
            btnConfirmar.disabled = true;
            btnConfirmar.textContent = "Guardando en disco...";
        }

        try {
            const resultado = await sincronizarHotspotsConElectron(
                window.currentProduct.id, 
                window.hotspotsAcumulados
            );
            
            if (resultado && resultado.success) {
                window.currentProduct.hotspots = JSON.parse(JSON.stringify(window.hotspotsAcumulados));
                localStorage.removeItem(`hotspots_${window.currentProduct.id}`);
                
                if (feedback) feedback.innerHTML = `<span style="color: #00ffcc;">✓ Cambios guardados y consolidados</span>`;
                if (typeof inicializarNodosHotspots === 'function') inicializarNodosHotspots();
            } else {
                if (feedback) feedback.innerHTML = `<span style="color: #f87171;">Error al escribir en disco.</span>`;
            }
        } catch (error) {
            if (feedback) feedback.innerHTML = `<span style="color: #f87171;">Error crítico de escritura.</span>`;
        } finally {
            if (btnConfirmar) {
                btnConfirmar.disabled = false;
                btnConfirmar.textContent = "Confirmar Cambios";
            }
        }
    }
}