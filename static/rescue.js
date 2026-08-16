(function () {
    const state = {
        teams: [],
        groups: [],
        map: null,
        teamMarkers: new Map(),
        groupMarkers: new Map(),
        routeLines: [],
        syncTimer: null,
        myTeamId: localStorage.getItem("rescue_team_id") || "",
        myTeamName: localStorage.getItem("rescue_team_name") || "",
        locationSource: localStorage.getItem("rescue_location_source") || "auto",
        lastFix: null,
        lastFixSource: null
    };

    const el = {
        rescueNow: document.getElementById("rescueNow"),
        rescueSync: document.getElementById("rescueSync"),
        teamIdInput: document.getElementById("teamIdInput"),
        teamNameInput: document.getElementById("teamNameInput"),
        locationSourceInput: document.getElementById("locationSourceInput"),
        manualLatInput: document.getElementById("manualLatInput"),
        manualLonInput: document.getElementById("manualLonInput"),
        manualCoordsBlock: document.getElementById("manualCoordsBlock"),
        srcBrowserBtn: document.getElementById("srcBrowserBtn"),
        srcManualBtn: document.getElementById("srcManualBtn"),
        srcDroneBtn: document.getElementById("srcDroneBtn"),
        pushLocationBtn: document.getElementById("pushLocationBtn"),
        importLatestBtn: document.getElementById("importLatestBtn"),
        refreshStateBtn: document.getElementById("refreshStateBtn"),
        geoHint: document.getElementById("geoHint"),
        teamStatus: document.getElementById("teamStatus"),
        teamList: document.getElementById("teamList"),
        groupList: document.getElementById("groupList"),
        teamCountBadge: document.getElementById("teamCountBadge"),
        groupCountBadge: document.getElementById("groupCountBadge"),
        rescueToast: document.getElementById("rescueToast")
    };

    const statusColors = {
        unassigned: "#ff5f6d",
        assigned: "#ffd166",
        in_progress: "#4cc9f0",
        rescued: "#80ed99",
        completed: "#80ed99"
    };

    function showToast(msg) {
        el.rescueToast.textContent = msg;
        el.rescueToast.classList.add("show");
        setTimeout(() => el.rescueToast.classList.remove("show"), 2300);
    }

    function statusClass(status) {
        const s = String(status || "unassigned").toLowerCase();
        if (s === "in progress") {
            return "in_progress";
        }
        return s.replace(/\s+/g, "_");
    }

    function fmtMeters(m) {
        const n = Number(m);
        if (!Number.isFinite(n)) {
            return "-";
        }
        return `${Math.round(n)} m`;
    }

    function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function updateClock() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        el.rescueNow.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function setSyncState(ok, text) {
        el.rescueSync.textContent = text;
        el.rescueSync.classList.toggle("connected", !!ok);
        el.rescueSync.classList.toggle("disconnected", !ok);
    }

    function normalizeLocationSource(raw) {
        const v = String(raw || "auto").trim().toLowerCase();
        if (["auto", "browser", "drone", "manual"].includes(v)) {
            return v;
        }
        return "auto";
    }

    function sourceLabel(source) {
        if (source === "browser") {
            return "Browser GPS";
        }
        if (source === "drone") {
            return "Drone GPS";
        }
        if (source === "manual") {
            return "Manual Coordinates";
        }
        return "Auto";
    }

    function isSecureGeoContext() {
        const host = String(window.location.hostname || "").toLowerCase();
        const localhost = host === "localhost" || host === "127.0.0.1";
        return window.isSecureContext || localhost;
    }

    function syncSourceToggle(source) {
        const norm = normalizeLocationSource(source);
        [el.srcBrowserBtn, el.srcManualBtn, el.srcDroneBtn].forEach((btn) => {
            if (btn) {
                btn.classList.toggle("active", btn.dataset.src === norm);
            }
        });
        el.locationSourceInput.value = norm;
        el.manualCoordsBlock.style.display = norm === "manual" ? "" : "none";
        state.locationSource = norm;
        localStorage.setItem("rescue_location_source", norm);
    }

    function updateGeoHint() {
        const source = normalizeLocationSource(el.locationSourceInput.value || state.locationSource);
        state.locationSource = source;
        localStorage.setItem("rescue_location_source", source);

        if ((source === "auto" || source === "browser") && !isSecureGeoContext()) {
            el.geoHint.textContent = "Browser GPS may be blocked on non-HTTPS origins. Use https://, localhost, Drone GPS, or Manual mode.";
            return;
        }
        if (source === "drone") {
            el.geoHint.textContent = "Drone mode uses backend /gps telemetry from Jetson/Cube.";
            return;
        }
        if (source === "manual") {
            el.geoHint.textContent = "Manual mode uses Manual Latitude/Longitude fields.";
            return;
        }
        el.geoHint.textContent = "Tip: Browser GPS usually requires HTTPS or localhost.";
    }

    function geolocationErrorText(err) {
        if (!err) {
            return "Unable to read browser GPS";
        }
        if (typeof err.code === "number") {
            if (err.code === 1) {
                return "Browser location permission denied";
            }
            if (err.code === 2) {
                return "Browser location unavailable";
            }
            if (err.code === 3) {
                return "Browser location request timed out";
            }
        }
        if (err.message) {
            return String(err.message);
        }
        return "Unable to read browser GPS";
    }

    function rescueBackendHint(raw) {
        const text = String(raw || "");
        if (
            text.includes("PGRST205")
            || text.includes("public.rescue_teams")
            || text.includes("public.rescue_groups")
        ) {
            return "Rescue tables are missing in Supabase. Run supabase_rescue_schema.sql, then refresh this page.";
        }
        return "";
    }

    function friendlyBackendError(raw, fallbackText) {
        const hint = rescueBackendHint(raw);
        if (hint) {
            return hint;
        }
        const text = String(raw || "").trim();
        return text || fallbackText;
    }

    function parseManualCoordinates() {
        const lat = Number(el.manualLatInput.value);
        const lon = Number(el.manualLonInput.value);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error("Manual coordinates are invalid");
        }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            throw new Error("Manual coordinates out of range");
        }
        return { latitude: lat, longitude: lon, source: "manual" };
    }

    function getBrowserCoordinates() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Browser geolocation not supported"));
                return;
            }
            if (!isSecureGeoContext()) {
                reject(new Error("Browser GPS requires HTTPS or localhost"));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    resolve({
                        latitude: Number(pos.coords.latitude),
                        longitude: Number(pos.coords.longitude),
                        source: "browser"
                    });
                },
                (err) => reject(new Error(geolocationErrorText(err))),
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
            );
        });
    }

    function getDroneCoordinates() {
        return fetch("/gps")
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok || data.lat === null || data.lon === null) {
                    throw new Error(data.error ? `Drone GPS unavailable: ${data.error}` : "Drone GPS unavailable");
                }
                return {
                    latitude: Number(data.lat),
                    longitude: Number(data.lon),
                    source: "drone"
                };
            });
    }

    async function resolveCoordinatesFromSource(sourceRaw) {
        const source = normalizeLocationSource(sourceRaw);
        if (source === "browser") {
            return getBrowserCoordinates();
        }
        if (source === "drone") {
            return getDroneCoordinates();
        }
        if (source === "manual") {
            return parseManualCoordinates();
        }

        const attempts = [];
        try {
            return await getBrowserCoordinates();
        } catch (e) {
            attempts.push(String(e.message || e));
        }
        try {
            return await getDroneCoordinates();
        } catch (e) {
            attempts.push(String(e.message || e));
        }
        try {
            return parseManualCoordinates();
        } catch (e) {
            attempts.push(String(e.message || e));
        }

        throw new Error(`Auto source failed: ${attempts.join(" | ")}`);
    }

    function initMap() {
        state.map = L.map("rescueMap", { zoomControl: true }).setView([3.139, 101.6869], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 20,
            attribution: "&copy; OpenStreetMap"
        }).addTo(state.map);
    }

    function clearMapLayers() {
        state.teamMarkers.forEach((m) => state.map.removeLayer(m));
        state.groupMarkers.forEach((m) => state.map.removeLayer(m));
        state.routeLines.forEach((l) => state.map.removeLayer(l));
        state.teamMarkers.clear();
        state.groupMarkers.clear();
        state.routeLines = [];
    }

    function teamInitial(name) {
        const s = String(name || "T").trim();
        return s ? s[0].toUpperCase() : "T";
    }

    function makeGroupIcon(status) {
        const cls = statusClass(status);
        const color = statusColors[cls] || statusColors.unassigned;
        return L.divIcon({
            className: "rescue-marker-wrapper",
            html: `<div class="rescue-marker" style="background:${color};"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
    }

    function makeTeamIcon(name) {
        return L.divIcon({
            className: "rescue-team-marker-wrapper",
            html: `<div class="rescue-team-marker">${teamInitial(name)}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });
    }

    function drawMap() {
        clearMapLayers();

        const bounds = [];
        state.groups.forEach((g) => {
            const lat = Number(g.latitude);
            const lon = Number(g.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }
            const marker = L.marker([lat, lon], { icon: makeGroupIcon(g.status) }).addTo(state.map);
            marker.bindPopup(`<strong>${g.group_id}</strong><br>Status: ${g.status || "unassigned"}<br>Victims: ${g.victim_count || 0}<br>Assigned: ${g.assigned_team || "-"}`);
            state.groupMarkers.set(String(g.group_id), marker);
            bounds.push([lat, lon]);
        });

        const teamById = new Map();
        state.teams.forEach((t) => {
            teamById.set(String(t.team_id), t);
            const lat = Number(t.latitude);
            const lon = Number(t.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }
            const marker = L.marker([lat, lon], { icon: makeTeamIcon(t.team_name || t.team_id) }).addTo(state.map);
            marker.bindPopup(`<strong>${t.team_name || t.team_id}</strong><br>ID: ${t.team_id}<br>Status: ${t.status || "active"}<br>Current Group: ${t.current_group || "-"}`);
            state.teamMarkers.set(String(t.team_id), marker);
            bounds.push([lat, lon]);
        });

        state.groups.forEach((g) => {
            const assigned = String(g.assigned_team || "").trim();
            if (!assigned) {
                return;
            }
            const t = teamById.get(assigned);
            if (!t) {
                return;
            }
            const glat = Number(g.latitude);
            const glon = Number(g.longitude);
            const tlat = Number(t.latitude);
            const tlon = Number(t.longitude);
            if (![glat, glon, tlat, tlon].every(Number.isFinite)) {
                return;
            }
            const line = L.polyline([[tlat, tlon], [glat, glon]], {
                color: "#4cc9f0",
                weight: 2,
                opacity: 0.8,
                dashArray: "6,4"
            }).addTo(state.map);
            state.routeLines.push(line);
        });

        if (bounds.length > 0) {
            const b = L.latLngBounds(bounds);
            state.map.fitBounds(b.pad(0.2));
        }
    }

    function nearestGroupForTeam(team) {
        const tLat = Number(team.latitude);
        const tLon = Number(team.longitude);
        if (!Number.isFinite(tLat) || !Number.isFinite(tLon)) {
            return null;
        }

        let best = null;
        state.groups.forEach((g) => {
            const cls = statusClass(g.status || "unassigned");
            if (cls !== "unassigned") {
                return;
            }
            const gLat = Number(g.latitude);
            const gLon = Number(g.longitude);
            if (!Number.isFinite(gLat) || !Number.isFinite(gLon)) {
                return;
            }
            const d = haversineMeters(tLat, tLon, gLat, gLon);
            if (!best || d < best.distance) {
                best = { group: g, distance: d };
            }
        });
        return best;
    }

    function deleteTeam(teamId) {
        if (!confirm(`Remove team "${teamId}" from the map? This cannot be undone.`)) {
            return;
        }
        fetch("/api/rescue/team/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team_id: teamId })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    const msg = String(data.error || "Delete failed");
                    showToast(msg.length > 100 ? `${msg.slice(0, 100)}…` : msg);
                    el.teamStatus.textContent = `Delete failed: ${msg}`;
                    return;
                }
                showToast(`Team ${teamId} removed`);
                el.teamStatus.textContent = `Team ${teamId} successfully removed.`;
                fetchState();
            })
            .catch((err) => {
                showToast("Delete failed — network error");
                el.teamStatus.textContent = `Delete failed: ${err.message || err}`;
            });
    }

    function renderTeams() {
        if (el.teamCountBadge) {
            el.teamCountBadge.textContent = state.teams.length;
        }
        if (!state.teams.length) {
            el.teamList.innerHTML = '<div class="rc-empty-hint">No active teams yet.</div>';
            return;
        }

        el.teamList.innerHTML = state.teams.map((t) => {
            const nearest = nearestGroupForTeam(t);
            const isMe = String(t.team_id) === String(state.myTeamId);
            return `
                <div class="rescue-item rc-team-card${isMe ? " rc-team-me" : ""}">
                    <div class="rc-card-header">
                        <span class="rc-card-name">${t.team_name || t.team_id}</span>
                        ${isMe ? '<span class="rc-me-badge">YOU</span>' : ""}
                        <span class="rc-card-id">${t.team_id}</span>
                        <button class="btn rc-delete-btn rescue-delete-team-btn" data-team-id="${t.team_id}" title="Remove team">🗑</button>
                    </div>
                    <div class="rc-card-row">
                        <span class="rc-label">Location</span>
                        <span>${Number(t.latitude || 0).toFixed(6)}, ${Number(t.longitude || 0).toFixed(6)}</span>
                    </div>
                    <div class="rc-card-row">
                        <span class="rc-label">Assigned</span>
                        <span>${t.current_group || "—"}</span>
                        <span class="rc-label" style="margin-left:12px">Status</span>
                        <span class="status-pill ${statusClass(t.status || "active")}">${t.status || "active"}</span>
                    </div>
                    ${nearest ? `<div class="rc-card-row rc-nearest">
                        <span class="rc-label">Nearest open</span>
                        <span>${nearest.group.group_id} &bull; ${fmtMeters(nearest.distance)}</span>
                    </div>` : ""}
                </div>
            `;
        }).join("");

        el.teamList.querySelectorAll(".rescue-delete-team-btn").forEach((btn) => {
            btn.addEventListener("click", () => deleteTeam(btn.dataset.teamId));
        });
    }

    function claimGroup(groupId) {
        if (!state.myTeamId) {
            showToast("Set Team ID first");
            return;
        }
        fetch("/api/rescue/group/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ group_id: groupId, team_id: state.myTeamId })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    showToast(data.error || "Claim failed");
                    return;
                }
                showToast(`Claimed ${groupId}`);
                fetchState();
            })
            .catch(() => showToast("Claim failed"));
    }

    function setGroupStatus(groupId, status) {
        if (!state.myTeamId) {
            showToast("Set Team ID first");
            return;
        }
        fetch("/api/rescue/group/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ group_id: groupId, team_id: state.myTeamId, status })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    showToast(data.error || "Update failed");
                    return;
                }
                showToast(`Updated ${groupId} to ${status}`);
                fetchState();
            })
            .catch(() => showToast("Update failed"));
    }

    function renderGroups() {
        if (el.groupCountBadge) {
            el.groupCountBadge.textContent = state.groups.length;
        }
        if (!state.groups.length) {
            el.groupList.innerHTML = '<div class="rc-empty-hint">No victim groups yet.<br>Use <strong>Import Groups</strong> to load from latest mission.</div>';
            return;
        }

        const myTeam = String(state.myTeamId || "").trim();
        el.groupList.innerHTML = state.groups.map((g) => {
            const s = statusClass(g.status || "unassigned");
            const assigned = String(g.assigned_team || "").trim();
            const disabled = assigned && assigned !== myTeam;

            return `
                <div class="rescue-item rescue-group-item rc-group-card ${s}">
                    <div class="rc-card-header">
                        <span class="rc-card-name">${g.group_id}</span>
                        <span class="status-pill ${s}">${g.status || "unassigned"}</span>
                    </div>
                    <div class="rc-card-row">
                        <span class="rc-label">Victims</span>
                        <span class="rc-victims-count">${g.victim_count || 0}</span>
                        <span class="rc-label" style="margin-left:12px">Assigned to</span>
                        <span>${assigned || "—"}</span>
                    </div>
                    <div class="rc-card-row">
                        <span class="rc-label">Location</span>
                        <span>${Number(g.latitude || 0).toFixed(6)}, ${Number(g.longitude || 0).toFixed(6)}</span>
                    </div>
                    <div class="rc-group-actions">
                        <button class="btn btn-outline rescue-claim-btn" data-group-id="${g.group_id}" ${disabled ? "disabled" : ""}>
                            🏳 Claim
                        </button>
                        <button class="btn btn-outline rescue-progress-btn" data-group-id="${g.group_id}" ${disabled ? "disabled" : ""}>
                            🔄 In Progress
                        </button>
                        <button class="btn btn-primary rescue-complete-btn" data-group-id="${g.group_id}" ${disabled ? "disabled" : ""}>
                            ✅ Complete
                        </button>
                    </div>
                    ${disabled ? `<div class="rc-lock-notice">🔒 Handled by ${assigned}</div>` : ""}
                </div>
            `;
        }).join("");

        el.groupList.querySelectorAll(".rescue-claim-btn").forEach((btn) => {
            btn.addEventListener("click", () => claimGroup(btn.dataset.groupId));
        });
        el.groupList.querySelectorAll(".rescue-progress-btn").forEach((btn) => {
            btn.addEventListener("click", () => setGroupStatus(btn.dataset.groupId, "in_progress"));
        });
        el.groupList.querySelectorAll(".rescue-complete-btn").forEach((btn) => {
            btn.addEventListener("click", () => setGroupStatus(btn.dataset.groupId, "completed"));
        });
    }

    function fetchState() {
        fetch("/api/rescue/state")
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    setSyncState(false, "Sync Error");
                    el.teamStatus.textContent = friendlyBackendError(data.error, "Rescue state unavailable");
                    return;
                }
                state.teams = Array.isArray(data.teams) ? data.teams : [];
                state.groups = Array.isArray(data.groups) ? data.groups : [];
                setSyncState(true, "Live Sync Active");
                renderTeams();
                renderGroups();
                drawMap();
            })
            .catch(() => {
                setSyncState(false, "Sync Offline");
            });
    }

    function submitTeamLocation(payload, options = {}) {
        const silent = options.silent === true;
        const refresh = options.refresh !== false;

        return fetch("/api/rescue/team/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    throw new Error(friendlyBackendError(data.error, "Location upload failed"));
                }

                state.lastFix = {
                    team_id: payload.team_id,
                    team_name: payload.team_name,
                    latitude: payload.latitude,
                    longitude: payload.longitude,
                    status: payload.status || "active"
                };
                state.lastFixSource = options.source || state.lastFixSource;

                if (!silent) {
                    const via = options.source ? ` via ${sourceLabel(options.source)}` : "";
                    el.teamStatus.textContent = `Live location uploaded${via} for ${payload.team_name}.`;
                    showToast("Team location updated");
                }
                if (refresh) {
                    fetchState();
                }
                return data;
            });
    }

    function pushMyLocation(options = {}) {
        const silent = options.silent === true;

        state.myTeamId = String(el.teamIdInput.value || "").trim();
        state.myTeamName = String(el.teamNameInput.value || "").trim();
        state.locationSource = normalizeLocationSource(el.locationSourceInput.value || state.locationSource);

        if (!state.myTeamId) {
            if (!silent) {
                showToast("Team ID is required");
            }
            return Promise.resolve();
        }

        localStorage.setItem("rescue_team_id", state.myTeamId);
        localStorage.setItem("rescue_team_name", state.myTeamName);
        localStorage.setItem("rescue_location_source", state.locationSource);
        localStorage.setItem("rescue_manual_lat", String(el.manualLatInput.value || ""));
        localStorage.setItem("rescue_manual_lon", String(el.manualLonInput.value || ""));

        updateGeoHint();

        return resolveCoordinatesFromSource(state.locationSource)
            .then((coords) => {
                const payload = {
                    team_id: state.myTeamId,
                    team_name: state.myTeamName || state.myTeamId,
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    status: "active"
                };
                return submitTeamLocation(payload, {
                    silent,
                    source: coords.source,
                    refresh: options.refresh !== false
                });
            })
            .catch((e) => {
                const msg = String((e && e.message) || e || "Location update failed");
                el.teamStatus.textContent = `Location update failed: ${msg}`;
                if (!silent) {
                    showToast(msg.length > 90 ? `${msg.slice(0, 90)}...` : msg);
                }
            });
    }

    function importLatestMissionGroups() {
        fetch("/api/rescue/groups/import_latest_mission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    showToast(data.error || "Import failed");
                    return;
                }
                showToast(`Imported ${data.imported} groups from mission ${data.mission_id}`);
                fetchState();
            })
            .catch(() => showToast("Import failed"));
    }

    function bindEvents() {
        el.pushLocationBtn.addEventListener("click", pushMyLocation);
        el.importLatestBtn.addEventListener("click", importLatestMissionGroups);
        el.refreshStateBtn.addEventListener("click", fetchState);

        // Source toggle buttons
        [el.srcBrowserBtn, el.srcManualBtn, el.srcDroneBtn].forEach((btn) => {
            if (!btn) {
                return;
            }
            btn.addEventListener("click", () => {
                syncSourceToggle(btn.dataset.src);
                updateGeoHint();
            });
        });

        el.locationSourceInput.addEventListener("change", () => {
            syncSourceToggle(el.locationSourceInput.value);
            updateGeoHint();
        });
        el.manualLatInput.addEventListener("input", () => {
            localStorage.setItem("rescue_manual_lat", String(el.manualLatInput.value || ""));
        });
        el.manualLonInput.addEventListener("input", () => {
            localStorage.setItem("rescue_manual_lon", String(el.manualLonInput.value || ""));
        });
    }

    function init() {
        initMap();
        bindEvents();
        el.teamIdInput.value = state.myTeamId;
        el.teamNameInput.value = state.myTeamName;
        const savedSource = normalizeLocationSource(state.locationSource);
        syncSourceToggle(savedSource);
        el.manualLatInput.value = localStorage.getItem("rescue_manual_lat") || "";
        el.manualLonInput.value = localStorage.getItem("rescue_manual_lon") || "";
        updateGeoHint();

        updateClock();
        setInterval(updateClock, 1000);

        fetchState();
        state.syncTimer = setInterval(fetchState, 3000);

        // Keep team location fresh in active operations if user already configured team.
        setInterval(() => {
            if (state.myTeamId) {
                if (
                    state.lastFix
                    && Number.isFinite(Number(state.lastFix.latitude))
                    && Number.isFinite(Number(state.lastFix.longitude))
                ) {
                    submitTeamLocation(state.lastFix, {
                        silent: true,
                        source: state.lastFixSource || state.locationSource,
                        refresh: false
                    }).catch(() => {
                        // Silent heartbeat failure; full state sync continues separately.
                    });
                    return;
                }
                pushMyLocation({ silent: true, refresh: false });
            }
        }, 10000);
    }

    init();
})();
