// Shared file-upload widget + client-side image compression for contact / kapell forms.
// Renders a drag-and-drop zone, compresses images in-browser, and returns a FileList-like
// array of Blobs the caller can append to FormData as "attachments".

(function () {
    const MAX_FILES = 8;
    const MAX_FILE_MB = 10;
    const MAX_IMAGE_DIM = 1600;
    const JPEG_QUALITY = 0.78;
    const ACCEPT_MIME = 'image/*,application/pdf';

    function formatBytes(bytes) {
        if (!bytes) return '0 KB';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error || new Error('read error'));
            r.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image load error'));
            img.src = src;
        });
    }

    async function compressImageFile(file) {
        // HEIC/HEIF from iPhones can't be decoded by <img> in many browsers. Pass-through.
        if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
            return file;
        }
        try {
            const dataUrl = await readFileAsDataURL(file);
            const img = await loadImage(dataUrl);
            const { width, height } = img;
            const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
            const targetW = Math.max(1, Math.round(width * scale));
            const targetH = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetW, targetH);
            const blob = await new Promise(resolve =>
                canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
            );
            if (!blob || blob.size >= file.size) return file;
            const newName = file.name.replace(/\.(png|webp|gif|bmp|tiff?)$/i, '.jpg').replace(/\.jpeg$/i, '.jpg');
            return new File([blob], newName.endsWith('.jpg') || newName.endsWith('.jpeg') ? newName : newName + '.jpg', {
                type: 'image/jpeg',
                lastModified: Date.now(),
            });
        } catch (err) {
            console.warn('compressImageFile fallback:', err);
            return file;
        }
    }

    async function processIncomingFiles(files, existing, onProgress) {
        const accepted = [];
        for (const raw of files) {
            if (existing.length + accepted.length >= MAX_FILES) break;
            let f = raw;
            if (f.size > MAX_FILE_MB * 1024 * 1024 && !f.type.startsWith('image/')) {
                if (onProgress) onProgress(`Hoppar över ${f.name} (> ${MAX_FILE_MB} MB)`);
                continue;
            }
            if (f.type.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|bmp|tiff?|heic|heif)$/i.test(f.name)) {
                if (onProgress) onProgress(`Bearbetar ${f.name}...`);
                f = await compressImageFile(f);
            }
            if (f.size > MAX_FILE_MB * 1024 * 1024) {
                if (onProgress) onProgress(`Hoppar över ${f.name} (för stor efter komprimering)`);
                continue;
            }
            accepted.push(f);
        }
        return accepted;
    }

    function renderThumb(file, onRemove) {
        const tile = document.createElement('div');
        tile.style.cssText =
            'position:relative;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;background:#f8fafc;font-size:11px;';
        const preview = document.createElement('div');
        preview.style.cssText =
            'width:100%;height:90px;display:flex;align-items:center;justify-content:center;background:#e2e8f0;color:#475569;';
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            img.src = URL.createObjectURL(file);
            img.onload = () => URL.revokeObjectURL(img.src);
            preview.innerHTML = '';
            preview.appendChild(img);
        } else {
            preview.textContent = '📄';
            preview.style.fontSize = '28px';
        }
        const caption = document.createElement('div');
        caption.style.cssText =
            'padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155;';
        caption.title = file.name;
        caption.textContent = `${file.name} · ${formatBytes(file.size)}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Ta bort ${file.name}`);
        remove.style.cssText =
            'position:absolute;top:2px;right:2px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(10,35,66,0.82);color:#fff;cursor:pointer;font-size:14px;line-height:1;';
        remove.addEventListener('click', onRemove);
        tile.appendChild(preview);
        tile.appendChild(caption);
        tile.appendChild(remove);
        return tile;
    }

    function createAttachmentWidget(mountSelector, options = {}) {
        const mount =
            typeof mountSelector === 'string' ? document.querySelector(mountSelector) : mountSelector;
        if (!mount) {
            return { getFiles: () => [], reset: () => {} };
        }
        const label = options.label || 'Bilder/bilagor (valfritt)';
        const helper = options.helper || 'Ladda upp här';

        mount.innerHTML = `
            <div class="form-group">
                <label style="font-weight:600;display:block;margin-bottom:.3rem;">${label}</label>
                <div class="att-drop" tabindex="0" style="
                    border:2px dashed #cbd5e1;border-radius:10px;padding:1.1rem;
                    text-align:center;color:#475569;cursor:pointer;background:#f8fafc;
                    transition:all .15s ease;">
                    <div style="font-size:1.6rem;margin-bottom:.2rem;">📎</div>
                    <div style="font-size:.92rem;">${helper}</div>
                    <input type="file" class="att-input" multiple accept="${ACCEPT_MIME}"
                           style="display:none"/>
                </div>
                <div class="att-status" style="font-size:.82rem;color:#64748b;margin-top:.4rem;min-height:1.1em;"></div>
                <div class="att-grid" style="
                    display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
                    gap:.5rem;margin-top:.5rem;"></div>
            </div>
        `;

        const drop = mount.querySelector('.att-drop');
        const input = mount.querySelector('.att-input');
        const grid = mount.querySelector('.att-grid');
        const status = mount.querySelector('.att-status');
        let files = [];

        function rerender() {
            grid.innerHTML = '';
            files.forEach((file, idx) => {
                grid.appendChild(
                    renderThumb(file, () => {
                        files.splice(idx, 1);
                        rerender();
                    })
                );
            });
        }

        async function addFiles(fileList) {
            const incoming = Array.from(fileList || []);
            if (!incoming.length) return;
            drop.style.borderColor = '#c8a93f';
            const accepted = await processIncomingFiles(incoming, files, msg => (status.textContent = msg));
            files = files.concat(accepted).slice(0, MAX_FILES);
            const totalKb = files.reduce((s, f) => s + f.size, 0);
            status.textContent = files.length
                ? `${files.length} fil${files.length === 1 ? '' : 'er'} redo (${formatBytes(totalKb)})`
                : '';
            drop.style.borderColor = '#cbd5e1';
            rerender();
        }

        drop.addEventListener('click', () => input.click());
        drop.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.click();
            }
        });
        drop.addEventListener('dragover', e => {
            e.preventDefault();
            drop.style.background = '#eef2f7';
            drop.style.borderColor = '#0a2342';
        });
        drop.addEventListener('dragleave', () => {
            drop.style.background = '#f8fafc';
            drop.style.borderColor = '#cbd5e1';
        });
        drop.addEventListener('drop', e => {
            e.preventDefault();
            drop.style.background = '#f8fafc';
            drop.style.borderColor = '#cbd5e1';
            addFiles(e.dataTransfer.files);
        });
        input.addEventListener('change', e => {
            addFiles(e.target.files);
            input.value = '';
        });

        return {
            getFiles: () => files.slice(),
            reset: () => {
                files = [];
                rerender();
                status.textContent = '';
            },
        };
    }

    window.HenricssonsAttachments = {
        create: createAttachmentWidget,
    };
})();
