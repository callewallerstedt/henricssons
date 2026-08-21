/*
 * Notiser för adminpanelen som app på hemskärmen (PWA).
 *
 * Funktionen är en försöksfunktion och styrs från AI Lab → Notiser.
 * Filen sköter två saker:
 *   1. HenricssonsPush – ett litet API mot service workern och /api/push/*
 *   2. Panelen i AI Lab (#push-panel), om den finns på sidan
 *
 * På iPhone fungerar notiser bara när panelen är sparad på hemskärmen och
 * öppnad därifrån. Behörigheten måste dessutom begäras från ett riktigt
 * knapptryck – därför sker allt i klickhanteraren nedan.
 */
(function () {
    'use strict';

    const SW_URL = '/admin-sw.js';
    const SW_SCOPE = '/admin';

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function isSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
        return output;
    }

    function deviceLabel() {
        const ua = navigator.userAgent || '';
        let device = 'Enhet';
        if (/iPhone/i.test(ua)) device = 'iPhone';
        else if (/iPad/i.test(ua)) device = 'iPad';
        else if (/Android/i.test(ua)) device = 'Android';
        else if (/Macintosh/i.test(ua)) device = 'Mac';
        else if (/Windows/i.test(ua)) device = 'Windows';
        return isStandalone() ? `${device} (hemskärm)` : device;
    }

    async function apiFetch(url, options) {
        const response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
        if (response.status === 401 || response.status === 403) {
            throw new Error('Adminsessionen har gått ut');
        }
        return response;
    }

    async function getRegistration() {
        if (!isSupported()) return null;
        const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
        if (existing) return existing;
        try {
            return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        } catch (err) {
            console.warn('Service worker kunde inte registreras', err);
            return null;
        }
    }

    async function loadConfig() {
        const response = await apiFetch('/api/push/config');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    async function getLocalSubscription() {
        const registration = await getRegistration();
        if (!registration) return null;
        return registration.pushManager.getSubscription();
    }

    async function enable() {
        if (!isSupported()) {
            throw new Error('Den här webbläsaren stödjer inte notiser');
        }
        const config = await loadConfig();
        if (!config.available || !config.public_key) {
            throw new Error('Servern är inte förberedd för notiser ännu');
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            throw new Error(permission === 'denied'
                ? 'Notiser är blockerade för den här appen. Slå på dem i systeminställningarna.'
                : 'Notiser tilläts inte');
        }

        const registration = await getRegistration();
        if (!registration) throw new Error('Service workern kunde inte startas');
        await navigator.serviceWorker.ready;

        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            // Byt prenumeration om servern har fått ett nytt nyckelpar.
            const currentKey = subscription.options && subscription.options.applicationServerKey;
            if (currentKey) {
                const encoded = btoa(String.fromCharCode.apply(null, new Uint8Array(currentKey)))
                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                if (encoded !== config.public_key) {
                    await subscription.unsubscribe();
                    subscription = null;
                }
            }
        }
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(config.public_key),
            });
        }

        const response = await apiFetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscription.toJSON(), label: deviceLabel() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        return data;
    }

    async function disable() {
        const subscription = await getLocalSubscription();
        const endpoint = subscription ? subscription.endpoint : '';
        if (subscription) await subscription.unsubscribe();
        if (endpoint) {
            await apiFetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpoint }),
            });
        }
    }

    async function removeDevice(id) {
        const response = await apiFetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id }),
        });
        return response.json().catch(() => ({}));
    }

    async function saveSettings(payload) {
        const response = await apiFetch('/api/push/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        return data;
    }

    async function sendTest() {
        const subscription = await getLocalSubscription();
        const response = await apiFetch('/api/push/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription ? { endpoint: subscription.endpoint } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        return data;
    }

    window.HenricssonsPush = {
        isSupported: isSupported,
        isStandalone: isStandalone,
        loadConfig: loadConfig,
        getLocalSubscription: getLocalSubscription,
        enable: enable,
        disable: disable,
        removeDevice: removeDevice,
        saveSettings: saveSettings,
        sendTest: sendTest,
    };

    /* ---------------- Panelen i AI Lab ---------------- */

    function mountPanel() {
        const panel = document.getElementById('push-panel');
        if (!panel) return;

        const el = (id) => document.getElementById(id);
        const statusBox = el('push-status');
        const enableBtn = el('push-enable-btn');
        const disableBtn = el('push-disable-btn');
        const testBtn = el('push-test-btn');
        const toggle = el('push-enabled-toggle');
        const typesWrap = el('push-form-types');
        const deviceList = el('push-device-list');
        const noticeBox = el('push-notice');

        let config = null;

        function notice(message, isError) {
            if (!noticeBox) return;
            noticeBox.textContent = message || '';
            noticeBox.classList.toggle('is-hidden', !message);
            noticeBox.classList.toggle('is-error', Boolean(isError));
        }

        function setStatus(lines) {
            if (!statusBox) return;
            statusBox.innerHTML = '';
            lines.forEach(line => {
                const row = document.createElement('div');
                row.className = 'push-status-row' + (line.ok ? ' is-ok' : line.warn ? ' is-warn' : '');
                const mark = document.createElement('span');
                mark.className = 'push-status-mark';
                mark.textContent = line.ok ? 'OK' : line.warn ? '!' : '–';
                const text = document.createElement('div');
                const strong = document.createElement('strong');
                strong.textContent = line.title;
                const small = document.createElement('small');
                small.textContent = line.detail || '';
                text.appendChild(strong);
                text.appendChild(small);
                row.appendChild(mark);
                row.appendChild(text);
                statusBox.appendChild(row);
            });
        }

        function renderDevices() {
            if (!deviceList) return;
            deviceList.innerHTML = '';
            const rows = (config && config.subscriptions) || [];
            if (!rows.length) {
                const empty = document.createElement('p');
                empty.className = 'push-empty';
                empty.textContent = 'Inga enheter registrerade ännu.';
                deviceList.appendChild(empty);
                return;
            }
            rows.forEach(row => {
                const item = document.createElement('div');
                item.className = 'push-device';
                const info = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = row.label || 'Enhet';
                const meta = document.createElement('small');
                const added = row.created_at ? new Date(row.created_at).toLocaleString('sv-SE') : '';
                meta.textContent = row.last_error
                    ? `Senaste fel: ${row.last_error}`
                    : (added ? `Registrerad ${added}` : '');
                info.appendChild(name);
                info.appendChild(meta);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ghost-button push-device-remove';
                remove.textContent = 'Ta bort';
                remove.addEventListener('click', async () => {
                    remove.disabled = true;
                    try {
                        const data = await removeDevice(row.id);
                        config.subscriptions = data.subscriptions || [];
                        renderDevices();
                        notice('Enheten togs bort.');
                    } catch (err) {
                        notice(err.message || String(err), true);
                        remove.disabled = false;
                    }
                });
                item.appendChild(info);
                item.appendChild(remove);
                deviceList.appendChild(item);
            });
        }

        function renderFormTypes() {
            if (!typesWrap) return;
            typesWrap.innerHTML = '';
            const selected = new Set((config.settings && config.settings.form_types) || []);
            (config.form_types || []).forEach(type => {
                const label = document.createElement('label');
                label.className = 'push-checkbox';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = type.id;
                input.checked = selected.size === 0 || selected.has(type.id);
                const span = document.createElement('span');
                span.textContent = type.label;
                label.appendChild(input);
                label.appendChild(span);
                input.addEventListener('change', persistSettings);
                typesWrap.appendChild(label);
            });
        }

        function selectedFormTypes() {
            const inputs = typesWrap ? Array.from(typesWrap.querySelectorAll('input[type="checkbox"]')) : [];
            const checked = inputs.filter(input => input.checked).map(input => input.value);
            // Alla ikryssade = ingen filtrering.
            return checked.length === inputs.length ? [] : checked;
        }

        async function persistSettings() {
            try {
                const data = await saveSettings({
                    enabled: toggle ? toggle.checked : false,
                    form_types: selectedFormTypes(),
                });
                config.settings = data.settings;
                notice('Inställningarna sparades.');
            } catch (err) {
                notice(err.message || String(err), true);
            }
        }

        async function refresh() {
            try {
                config = await loadConfig();
            } catch (err) {
                notice(err.message || String(err), true);
                return;
            }

            const supported = isSupported();
            const permission = supported ? Notification.permission : 'unsupported';
            const subscription = supported ? await getLocalSubscription().catch(() => null) : null;
            const iosNeedsHomescreen = /iPhone|iPad/i.test(navigator.userAgent) && !isStandalone();

            setStatus([
                {
                    title: 'Servern',
                    detail: config.available && config.public_key
                        ? 'Redo att skicka notiser'
                        : 'pywebpush eller nycklar saknas på servern',
                    ok: Boolean(config.available && config.public_key),
                },
                {
                    title: 'Den här enheten',
                    detail: !supported
                        ? 'Webbläsaren stödjer inte notiser'
                        : iosNeedsHomescreen
                            ? 'Spara panelen på hemskärmen och öppna den därifrån'
                            : permission === 'granted'
                                ? (subscription ? 'Registrerad för notiser' : 'Tillåten, men inte registrerad')
                                : permission === 'denied'
                                    ? 'Notiser är blockerade i systeminställningarna'
                                    : 'Inte aktiverad ännu',
                    ok: Boolean(subscription && permission === 'granted'),
                    warn: supported && !subscription,
                },
                {
                    title: 'Nya inskick',
                    detail: config.settings && config.settings.enabled
                        ? 'Notiser skickas när ett inskick kommer in'
                        : 'Avstängt – inga notiser skickas',
                    ok: Boolean(config.settings && config.settings.enabled),
                },
            ]);

            if (toggle) toggle.checked = Boolean(config.settings && config.settings.enabled);
            if (enableBtn) enableBtn.disabled = !supported || iosNeedsHomescreen;
            if (disableBtn) disableBtn.hidden = !subscription;
            if (testBtn) testBtn.disabled = !subscription;
            renderFormTypes();
            renderDevices();
        }

        if (enableBtn) {
            enableBtn.addEventListener('click', async () => {
                enableBtn.disabled = true;
                const original = enableBtn.textContent;
                enableBtn.textContent = 'Aktiverar...';
                try {
                    await enable();
                    notice('Notiser är aktiverade på den här enheten.');
                } catch (err) {
                    notice(err.message || String(err), true);
                }
                enableBtn.textContent = original;
                enableBtn.disabled = false;
                refresh();
            });
        }

        if (disableBtn) {
            disableBtn.addEventListener('click', async () => {
                disableBtn.disabled = true;
                try {
                    await disable();
                    notice('Notiser avstängda på den här enheten.');
                } catch (err) {
                    notice(err.message || String(err), true);
                }
                disableBtn.disabled = false;
                refresh();
            });
        }

        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                const original = testBtn.textContent;
                testBtn.textContent = 'Skickar...';
                try {
                    await sendTest();
                    notice('Testnotisen är skickad.');
                } catch (err) {
                    notice(err.message || String(err), true);
                }
                testBtn.textContent = original;
                testBtn.disabled = false;
            });
        }

        if (toggle) toggle.addEventListener('change', persistSettings);

        refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountPanel);
    } else {
        mountPanel();
    }
})();
