 (function () {
    let db;
    let map;
    // idごとに対応するマーカーを記録するオブジェクト。削除時に参照する
    const markersById = {};

    // IndexedDBを開く
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('walk_app', 1);
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains('pins')) {
                    const store = db.createObjectStore('pins', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by_createdAt', 'createdAt');
                }
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
            request.onerror = (event) => {
                reject(event);
            };
        });
    }

    // IndexedDBにピンを追加
    function addPin(record) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['pins'], 'readwrite');
            const store = tx.objectStore('pins');
            const req = store.add(record);
            req.onsuccess = (event) => resolve(event.target.result);
            req.onerror = (event) => reject(event);
        });
    }

    // IndexedDBからすべてのピンを取得
    function getPins() {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['pins'], 'readonly');
            const store = tx.objectStore('pins');
            const req = store.openCursor();
            const results = [];
            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = (event) => reject(event);
        });
    }

    // 位置情報を取得（失敗時はnull）
    function getCurrentPosition() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve(pos),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
        });
    }

    // Leafletで地図を初期化
    function initMap() {
        // デフォルトは東京駅付近
        const defaultLatLng = [35.681236, 139.767125];
        map = L.map('map').setView(defaultLatLng, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }

    // マーカーを追加し、ポップアップに画像を表示
    function addMarker(pin) {
        // ピンに対応するマーカーを地図に追加
        const marker = L.marker([pin.lat, pin.lng]).addTo(map);
        // マーカーを保存しておく
        markersById[pin.id] = marker;
        const url = URL.createObjectURL(pin.imageBlob);
        const createdDate = new Date(pin.createdAt);
        // ポップアップに削除ボタンを含める
        const popupHtml = `
            <div style="text-align:center;">
                <img src="${url}" style="max-width:200px; max-height:150px; display:block; margin:0 auto;">
                <div style="margin-top:4px;">${createdDate.toLocaleString('ja-JP')}</div>
                <button class="delete-btn" data-id="${pin.id}" style="margin-top:6px; padding:4px 8px; background:#e74c3c; color:white; border:none; border-radius:4px; cursor:pointer;">削除</button>
            </div>
        `;
        marker.bindPopup(popupHtml);
    }

    // すべてのピンを読み込み
    async function refreshMarkers() {
        const pins = await getPins();
        pins.forEach(addMarker);
    }

    // DOM読み込み後の処理
    document.addEventListener('DOMContentLoaded', async () => {
        await openDB();
        initMap();

        // 起動時に現在位置を取得し、地図をその位置に移動させる
        const startPos = await getCurrentPosition();
        if (startPos && startPos.coords) {
            map.setView([startPos.coords.latitude, startPos.coords.longitude], 15);
        }

        // 登録済みマーカーを追加
        await refreshMarkers();

        const cameraBtn = document.getElementById('camera-btn');
        const fileInput = document.getElementById('file-input');

        cameraBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            // 位置を取得（失敗時は地図中心）
            const pos = await getCurrentPosition();
            const lat = pos && pos.coords ? pos.coords.latitude : map.getCenter().lat;
            const lng = pos && pos.coords ? pos.coords.longitude : map.getCenter().lng;

            const record = {
                lat: lat,
                lng: lng,
                createdAt: new Date().toISOString(),
                imageBlob: file
            };

            const id = await addPin(record);
            addMarker({ id, ...record });

            // 次の入力のためにリセット
            fileInput.value = '';
        });

        // 削除ボタンのクリックをハンドルする。確認後、IndexedDBと地図から削除。
        document.addEventListener('click', async (evt) => {
            const target = evt.target;
            if (target && target.classList.contains('delete-btn')) {
                const idStr = target.getAttribute('data-id');
                const id = idStr ? parseInt(idStr, 10) : null;
                if (id === null || Number.isNaN(id)) return;
                if (confirm('この写真を削除しますか？')) {
                    await deletePin(id);
                    const marker = markersById[id];
                    if (marker) {
                        map.removeLayer(marker);
                        delete markersById[id];
                    }
                }
            }
        });
    });

    // IndexedDBからピンを削除
    function deletePin(id) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['pins'], 'readwrite');
            const store = tx.objectStore('pins');
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = (event) => reject(event);
        });
    }
})();