// Inicializa os ícones do Lucide
lucide.createIcons();

// -------------------- GLOBAL STATE --------------------
const userSettings = {
    darkMode: true,
};

const SESSION_KEY = "voraUser";
let lastUploadedFileName = null;
let lastCleanedFileName = null; // guarda o arquivo _cleaned para forecast

// -------------------- SESSÃO / PERFIL --------------------
function getCurrentUser() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.error("Erro ao ler sessão do usuário:", e);
        return null;
    }
}

function getUserMeta() {
    const stored = getCurrentUser() || {};
    const email = stored.email || "visitante@vora.ai";
    const displayName =
        stored.nome ||
        stored.name ||
        stored.username ||
        (email ? email.split("@")[0] : "Usuário");
    const initial =
        (displayName && displayName.charAt(0).toUpperCase()) || "U";

    return { stored, email, displayName, initial };
}

function hydrateUserUI() {
    const { stored, email, displayName, initial } = getUserMeta();

    // Se não tiver usuário salvo, bloqueia acesso direto e volta pro index
    if (!stored || !stored.email) {
        window.location.href = "index.html";
        return;
    }

    const nameEl = document.getElementById("current-username");
    const emailEl = document.getElementById("current-email");
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = email;

    const avatarEls = document.querySelectorAll(
        "[data-user-avatar-initial]"
    );
    avatarEls.forEach((el) => (el.textContent = initial));

    document
        .querySelectorAll("[data-user-name]")
        .forEach((el) => (el.textContent = displayName));
    document
        .querySelectorAll("[data-user-email]")
        .forEach((el) => (el.textContent = email));

    const accountEmailEl = document.getElementById("dropdown-account-email");
    if (accountEmailEl) accountEmailEl.textContent = email;
}

hydrateUserUI();

// -------------------- HELPERS --------------------
function formatBytes(bytes) {
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(2)} ${units[i]}`;
}

function detectSeparator(sampleLine) {
    const candidates = [",", ";", "\t", "|"];
    let best = ",";
    let bestCount = -1;
    for (const sep of candidates) {
        const count = sampleLine.split(sep).length - 1;
        if (count > bestCount) {
            bestCount = count;
            best = sep;
        }
    }
    return best;
}

function updatePreviewTable(headers, rows) {
    const cleanTab = document.getElementById("tab-clean");
    if (!cleanTab) return;
    const table = cleanTab.querySelector("table");
    if (!table) return;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    if (!thead || !tbody) return;

    const rowCounterEl = document.getElementById("preview-row-count");

    if (!headers || headers.length === 0) {
        thead.innerHTML = `
            <tr>
                <th class="p-3 border-b border-r border-dynamic font-medium w-16">#</th>
            </tr>
        `;
        tbody.innerHTML = `
            <tr>
                <td class="p-8 text-center text-dynamic-dim opacity-50">
                    Não foi possível gerar prévia dos dados.
                </td>
            </tr>
        `;
        if (rowCounterEl) {
            rowCounterEl.textContent = "Mostrando 0 linhas";
        }
        return;
    }

    const limitedHeaders = headers.slice(0, 5);

    let headHtml = "<tr>";
    headHtml +=
        '<th class="p-3 border-b border-r border-dynamic font-medium w-16">#</th>';
    for (const h of limitedHeaders) {
        headHtml += `<th class="p-3 border-b border-r border-dynamic font-medium">${
            h ?? ""
        }</th>`;
    }
    headHtml += "</tr>";
    thead.innerHTML = headHtml;

    const limitedRows = (rows || []).slice(0, 10);
    let bodyHtml = "";

    if (limitedRows.length === 0) {
        bodyHtml = `
            <tr>
                <td colspan="${
                    limitedHeaders.length + 1
                }" class="p-8 text-center text-dynamic-dim opacity-50">
                    Arquivo enviado, mas não há linhas para exibir na prévia.
                </td>
            </tr>
        `;
    } else {
        limitedRows.forEach((row, idx) => {
            const cells = (row || []).slice(0, limitedHeaders.length);
            bodyHtml += "<tr>";
            bodyHtml += `<td class="p-2 border-b border-r border-dynamic text-dynamic-dim">${
                idx + 1
            }</td>`;
            cells.forEach((val) => {
                const safe =
                    val === undefined || val === null ? "" : String(val);
                bodyHtml += `<td class="p-2 border-b border-r border-dynamic text-dynamic-main max-w-[180px] truncate">${safe}</td>`;
            });
            bodyHtml += "</tr>";
        });
    }

    tbody.innerHTML = bodyHtml;

    if (rowCounterEl) {
        const rowCount = limitedRows.length;
        const label = rowCount === 1 ? "linha" : "linhas";
        rowCounterEl.textContent = `Mostrando ${rowCount} ${label}`;
    }
}

function generatePreviewFromFile(file) {
    if (!file || !file.name) return;
    const fileName = file.name;
    lastUploadedFileName = fileName;

    const ext = fileName.split(".").pop().toLowerCase();

    if (ext === "csv" || ext === "txt") {
        parseCsvPreview(file);
    } else if (ext === "json") {
        parseJsonPreview(file);
    } else {
        showToast(
            "Upload realizado. Prévia automática disponível apenas para CSV/JSON por enquanto."
        );
    }
}

function parseCsvPreview(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        try {
            const text = evt.target.result;
            if (!text) {
                updatePreviewTable([], []);
                return;
            }
            const lines = text
                .split(/\r?\n/)
                .filter((l) => l.trim() !== "");
            if (!lines.length) {
                updatePreviewTable([], []);
                return;
            }

            const sep = detectSeparator(lines[0]);
            const headers = lines[0].split(sep).map((h) => h.trim());

            const dataLines = lines.slice(1, 11);
            const rows = dataLines.map((line) =>
                line.split(sep).map((v) => v.trim())
            );

            updatePreviewTable(headers, rows);
            switchAppTab("clean");
        } catch (e) {
            console.error(e);
            showToast("Não foi possível gerar prévia do CSV.");
        }
    };
    reader.onerror = function () {
        showToast("Erro ao ler arquivo para prévia.");
    };
    reader.readAsText(file);
}

function parseJsonPreview(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        try {
            const text = evt.target.result;
            const parsed = JSON.parse(text);
            let arr = [];

            if (Array.isArray(parsed)) {
                arr = parsed;
            } else if (parsed && typeof parsed === "object") {
                arr = Object.values(parsed);
            }

            if (!arr.length || typeof arr[0] !== "object") {
                showToast("JSON sem formato tabular para prévia.");
                return;
            }

            const headers = Object.keys(arr[0]);
            const rows = arr
                .slice(0, 10)
                .map((obj) => headers.map((h) => obj[h]));

            updatePreviewTable(headers, rows);
            switchAppTab("clean");
        } catch (e) {
            console.error(e);
            showToast("Não foi possível gerar prévia do JSON.");
        }
    };
    reader.onerror = function () {
        showToast("Erro ao ler arquivo para prévia.");
    };
    reader.readAsText(file);
}

// -------------------- UPLOAD HANDLER --------------------
document
    .getElementById("hidden-file-input")
    .addEventListener("change", async function () {
        const file = this.files && this.files[0];
        if (!file) return;

        const fileName = file.name;

        const titleEl = document.getElementById("upload-card-title");
        if (titleEl) {
            titleEl.innerText = `Arquivo: ${fileName}`;
            titleEl.classList.add("text-accent");
        }

        generatePreviewFromFile(file);

        showToast(`Enviando arquivo: ${fileName}...`);

        const currentUser = getCurrentUser();
        const userEmail = currentUser && currentUser.email ? currentUser.email : null;

        const formData = new FormData();
        formData.append("file", file);
        if (userEmail) {
            formData.append("user_email", userEmail);
        }

        try {
            const res = await fetch(
                "http://127.0.0.1:8000/api/upload/dataset",
                {
                    method: "POST",
                    body: formData,
                }
            );

            const data = await res.json().catch(() => ({}));

            if (res.ok && data.ok) {
                showToast(
                    `Arquivo recebido pelo servidor: ${data.filename}`
                );

                // garante que usamos o nome salvo pelo backend
                lastUploadedFileName = data.filename || fileName;
                lastCleanedFileName = null; // reset, porque ainda não limpou esse arquivo

                const formattedSize = formatBytes(data.size_bytes);

                addChat(
                    `Arquivo <strong>${data.filename}</strong> recebido pelo servidor. Tamanho: <strong>${formattedSize}</strong>.`,
                    true
                );
            } else {
                showToast(data.detail || "Erro ao enviar arquivo");
                addChat(
                    "Houve um erro ao enviar o arquivo para a API.",
                    true
                );
            }
        } catch (err) {
            console.error(err);
            showToast("Erro de conexão com a API");
            addChat(
                "Não consegui conectar na API para enviar o arquivo.",
                true
            );
        }
    });

// -------------------- LIMPEZA SEPARADA --------------------
async function runCleaningPipeline() {
    if (!lastUploadedFileName) {
        showToast("Nenhum arquivo enviado ainda.");
        addChat(
            "Envie um arquivo na aba Conectar Dados antes de aplicar a limpeza.",
            true
        );
        return;
    }

    const user = getCurrentUser();
    if (!user || !user.email) {
        showToast("Nenhum usuário logado.");
        addChat(
            "Não consegui identificar a conta do usuário para aplicar a limpeza.",
            true
        );
        return;
    }

    const dupsCheckbox = document.getElementById("check-dups");
    const nullsCheckbox = document.getElementById("check-nulls");
    const fmtCheckbox = document.getElementById("check-fmt");

    const payload = {
        filename: lastUploadedFileName,
        user_email: user.email,
        remove_duplicates: dupsCheckbox ? dupsCheckbox.checked : true,
        fix_missing: nullsCheckbox ? nullsCheckbox.checked : true,
        standardize_formats: fmtCheckbox ? fmtCheckbox.checked : true,
    };

    try {
        const res = await fetch(
            "http://127.0.0.1:8000/api/clean/dataset",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            console.error("Erro na limpeza:", data);
            showToast(data.detail || "Erro ao limpar dados");
            addChat(
                "Houve um erro ao aplicar a limpeza nos dados.",
                true
            );
            return;
        }

        // guardar o nome do arquivo limpo para usar no forecast
        if (data.cleaned_filename) {
            lastCleanedFileName = data.cleaned_filename;
        }

        if (
            Array.isArray(data.preview_headers) &&
            Array.isArray(data.preview_rows)
        ) {
            updatePreviewTable(data.preview_headers, data.preview_rows);
            switchAppTab("clean");
        }

        addChat(
            `Limpeza aplicada ao arquivo <strong>${payload.filename}</strong>.<br>` +
                `Linhas antes: <strong>${data.rows_before}</strong> → depois: <strong>${data.rows_after}</strong>.<br>` +
                `Duplicados removidos: <strong>${data.duplicates_removed}</strong>.<br>` +
                `Valores vazios (totais) antes: <strong>${data.missing_before}</strong> → depois: <strong>${data.missing_after}</strong>.`,
            true
        );
        showToast("Limpeza aplicada com sucesso.");
    } catch (err) {
        console.error(err);
        showToast("Erro de conexão com a API");
        addChat(
            "Não consegui conectar na API para limpar os dados.",
            true
        );
    }
}

// -------------------- TABS / LAYOUT --------------------
function switchAppTab(tabName) {
    document.querySelectorAll(".app-tab-content").forEach((el) => {
        el.classList.add("hidden");
        el.classList.remove("flex");
    });
    const tab = document.getElementById("tab-" + tabName);
    if (tab) {
        tab.classList.remove("hidden");
        tab.classList.add("flex");
    }

    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.remove("active", "border-b-2", "text-accent", "text-dynamic-main");
        btn.classList.add("text-dynamic-dim");
    });
    const activeBtn = document.getElementById("btn-tab-" + tabName);
    if (activeBtn) {
        activeBtn.classList.add("active", "border-b-2", "text-accent");
        activeBtn.classList.remove("text-dynamic-dim");
    }

    const chatSidebar = document.getElementById("app-chat-sidebar");
    if (!chatSidebar) return;
    if (tabName === "terminal") {
        chatSidebar.classList.remove("hidden");
        chatSidebar.classList.add("flex");
    } else {
        chatSidebar.classList.add("hidden");
        chatSidebar.classList.remove("flex");
    }
}

// -------------------- USER DROPDOWN --------------------
function toggleUserMenu() {
    const menu = document.getElementById("user-dropdown");
    const chevron = document.getElementById("user-chevron");
    if (!menu || !chevron) return;

    if (menu.classList.contains("hidden")) {
        menu.classList.remove("hidden");
        menu.classList.add("scale-enter");
        chevron.style.transform = "rotate(180deg)";
    } else {
        menu.classList.add("hidden");
        menu.classList.remove("scale-enter");
        chevron.style.transform = "rotate(0deg)";
    }
}

document.addEventListener("click", function (event) {
    const container = document.getElementById("user-menu-container");
    const menu = document.getElementById("user-dropdown");
    const chevron = document.getElementById("user-chevron");
    if (!container || !menu || !chevron) return;

    if (!container.contains(event.target) && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
        chevron.style.transform = "rotate(0deg)";
    }
});

// -------------------- THEME SETTINGS --------------------
function toggleSwitch(el, key) {
    const isActive = !userSettings[key];
    userSettings[key] = isActive;

    const knob = el.querySelector("div");
    if (isActive) {
        el.classList.remove("bg-gray-400");
        el.classList.add("bg-accent");
        knob.classList.remove("left-1");
        knob.classList.add("right-1");
    } else {
        el.classList.remove("bg-accent");
        el.classList.add("bg-gray-400");
        knob.classList.remove("right-1");
        knob.classList.add("left-1");
    }

    applySettingEffect(key, isActive);
}

function applySettingEffect(key, isActive) {
    if (key === "darkMode") {
        const root = document.documentElement;
        if (isActive) {
            root.style.setProperty("--bg-core", "#0A0A0C");
            root.style.setProperty("--bg-panel", "rgba(21, 21, 26, 0.9)");
            root.style.setProperty("--bg-surface", "rgba(13, 13, 17, 0.8)");
            root.style.setProperty("--bg-card", "rgba(20, 20, 25, 0.6)");
            root.style.setProperty("--bg-input", "rgba(0,0,0,0.3)");
            root.style.setProperty("--border-std", "rgba(255, 255, 255, 0.08)");
            root.style.setProperty("--text-main", "#E2E8F0");
            root.style.setProperty("--text-dim", "#94a3b8");
            document.getElementById("platform-view").style.backgroundColor =
                "#0A0A0C";
        } else {
            root.style.setProperty("--bg-core", "#F8FAFC");
            root.style.setProperty("--bg-panel", "#FFFFFF");
            root.style.setProperty("--bg-surface", "#FFFFFF");
            root.style.setProperty("--bg-card", "rgba(255, 255, 255, 0.9)");
            root.style.setProperty("--bg-input", "#F1F5F9");
            root.style.setProperty("--border-std", "#E2E8F0");
            root.style.setProperty("--text-main", "#0F172A");
            root.style.setProperty("--text-dim", "#64748B");
            document.getElementById("platform-view").style.backgroundColor =
                "#F8FAFC";
        }
        showToast(`Modo Escuro ${isActive ? "Ativado" : "Desativado"}`);
    }
}

// -------------------- STATUS DOS SWITCHES DE LIMPEZA --------------------
function updateToggleStatus(checkbox, statusId) {
    const statusEl = document.getElementById(statusId);
    if (!statusEl) return;

    if (checkbox.checked) {
        statusEl.innerText = "ATIVO";
        statusEl.classList.remove("text-dynamic-dim");
        statusEl.classList.add("text-accent");
    } else {
        statusEl.innerText = "INATIVO";
        statusEl.classList.remove("text-accent");
        statusEl.classList.add("text-dynamic-dim");
    }
}

// -------------------- MODAL & TOAST --------------------
const modal = document.getElementById("sys-modal");
const modalContent = document.getElementById("sys-modal-content");
const modalBody = document.getElementById("modal-body");

function openModal(htmlContent) {
    modalBody.innerHTML = htmlContent;
    modal.classList.remove("hidden");
    void modal.offsetWidth;
    modal.classList.remove("opacity-0");
    modalContent.classList.remove("scale-100");
    modalContent.classList.add("scale-95");
    lucide.createIcons();
    const dropdown = document.getElementById("user-dropdown");
    if (dropdown) dropdown.classList.add("hidden");
}

function closeModal() {
    modal.classList.add("opacity-0");
    modalContent.classList.remove("scale-95");
    modalContent.classList.add("scale-100");
    setTimeout(() => {
        modal.classList.add("hidden");
    }, 300);
}

function showToast(msg) {
    const toast = document.getElementById("toast");
    document.getElementById("toast-msg").innerText = msg;
    toast.classList.remove("translate-y-20", "opacity-0");
    setTimeout(() => {
        toast.classList.add("translate-y-20", "opacity-0");
    }, 8000);
}

// -------------------- AÇÕES DO USUÁRIO --------------------
const appActions = {
    openProfile: () => {
        const { email, displayName, initial } = getUserMeta();

        const html = `
            <div class="text-center mb-6">
                <div class="w-20 h-20 rounded-full bg-gradient-to-br from-[#2a2a30] to-[#15151A] border-2 border-accent mx-auto flex items-center justify-center text-2xl font-bold text-white mb-3 shadow-lg shadow-purple-500/20">
                    ${initial}
                </div>
                <h3 class="text-xl font-bold text-dynamic-main">${displayName}</h3>
                <div class="flex justify-center my-3">
                    <img src="./img/LogoV.png" class="h-10 w-auto object-contain" alt="Logo">
                </div>
                <p class="font-mono text-sm text-dynamic-dim">${email}</p>
                <span class="mt-2 inline-block px-2 py-0.5 bg-accent/20 text-accent text-xs rounded border border-accent/20">
                    PRO PLAN
                </span>
            </div>
            <div class="mt-4">
                <button
                    onclick="closeModal()"
                    class="w-full bg-dynamic-surface hover:bg-white/10 text-dynamic-main py-2 rounded-lg border border-dynamic transition-colors font-medium text-sm">
                    Fechar
                </button>
            </div>
        `;
        openModal(html);
    },

    openSettings: () => {
        const html = `
            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-dynamic-main">
                <i data-lucide="settings" class="w-5 h-5 text-accent"></i> Configurações
            </h3>
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <span class="text-sm text-dynamic-main font-medium">Modo Escuro</span>
                    <div onclick="toggleSwitch(this, 'darkMode')" class="w-10 h-5 ${
                        userSettings.darkMode ? "bg-accent" : "bg-gray-400"
                    } rounded-full relative cursor-pointer transition-colors shadow-inner">
                        <div class="absolute ${
                            userSettings.darkMode ? "right-1" : "left-1"
                        } top-1 w-3 h-3 bg-white rounded-full transition-all duration-200 shadow-sm"></div>
                    </div>
                </div>
                <div class="text-xs text-dynamic-dim mt-2 p-3 bg-dynamic-surface rounded border border-dynamic"></div>
                <button onclick="closeModal()" class="w-full mt-6 bg-dynamic-main text-dynamic-inverse hover:opacity-90 py-2 rounded-lg transition-colors font-bold text-sm shadow-lg shadow-purple-900/20">
                    Salvar Alterações
                </button>
            </div>
        `;
        openModal(html);
    },

    addAccount: () => {
        const html = `
            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-dynamic-main">
                <i data-lucide="user-plus" class="w-5 h-5 text-accent"></i> Nova Conta
            </h3>
            <div class="space-y-3">
                <div>
                    <label class="text-xs uppercase font-bold mb-1 block text-dynamic-dim">Email Corporativo</label>
                    <input type="email" class="input-std" placeholder="user@empresa.com">
                </div>
                <button onclick="showToast('Link de convite enviado!'); closeModal()" class="w-full mt-4 bg-dynamic-main text-dynamic-inverse py-2 rounded-lg transition-colors font-bold text-sm hover:opacity-90">
                    Enviar Convite
                </button>
            </div>
        `;
        openModal(html);
    },

    switchAccount: () => {
        const { email, initial } = getUserMeta();

        const html = `
            <h3 class="text-lg font-bold mb-4 text-dynamic-main">Trocar Conta</h3>
            <div class="space-y-2">
                <div class="p-3 bg-accent/20 border border-accent rounded-lg flex items-center justify-between cursor-default">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-black">${initial}</div>
                        <div class="text-sm text-dynamic-main">${email}</div>
                    </div>
                    <span class="text-[10px] bg-accent text-white px-2 py-0.5 rounded">ATUAL</span>
                </div>
                <div onclick="showToast('Trocando para Guest.'); setTimeout(()=>{ localStorage.removeItem('voraUser'); location.reload(); }, 1000)" class="p-3 bg-dynamic-surface border border-dynamic rounded-lg flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-xs font-bold text-white">G</div>
                        <div class="text-sm text-dynamic-dim">guest@demo.com</div>
                    </div>
                </div>
            </div>
        `;
        openModal(html);
    },

    logout: () => {
        const menu = document.getElementById("user-dropdown");
        if (menu) menu.classList.add("hidden");
        localStorage.removeItem("voraUser");

        const overlay = document.createElement("div");
        overlay.className =
            "fixed inset-0 z-[999] bg-[#0A0A0C] flex flex-col items-center justify-center animate-fadeIn";

        overlay.innerHTML = `
            <div class="relative flex flex-col items-center justify-center">
                <div class="w-16 h-16 border-4 border-[#8B5CF6]/30 border-t-[#8B5CF6] rounded-full animate-spin mb-6 drop-shadow-[0_0_10px_rgba(139,92,246,0.5)]"></div>
                <div class="text-center space-y-2">
                    <h2 class="text-white text-lg font-bold tracking-widest">VORA</h2>
                    <p class="text-gray-400 text-xs font-mono animate-pulse">Saindo.</p>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        setTimeout(() => {
            window.location.href = "index.html";
        }, 2500);
    },
};

// -------------------- OUTROS --------------------
function runSimulation() {
    console.log("Simulação desativada.");
}

function addChat(msg, isAgent = false) {
    const div = document.createElement("div");
    div.className = `flex gap-3 ${isAgent ? "animate-fadeIn" : ""}`;
    if (isAgent) {
        div.innerHTML = `
            <div class="w-6 h-6 rounded flex-shrink-0 bg-accent/20 flex items-center justify-center text-[10px] text-accent border border-accent/30">V</div>
            <div class="text-dynamic-main bg-accent/5 p-3 rounded-lg rounded-tl-none border border-accent/20">${msg}</div>
        `;
    } else {
        div.innerHTML = `
            <div class="text-dynamic-main bg-white/5 p-3 rounded-lg rounded-tr-none border border-dynamic ml-auto text-right">${msg}</div>
            <div class="w-6 h-6 rounded-full flex-shrink-0 bg-gradient-to-br from-[#2a2a30] to-[#15151A] border border-white/20 flex items-center justify-center text-[10px] text-white font-bold shadow-lg shadow-purple-900/10">A</div>
        `;
    }
    document.getElementById("chatContainer").appendChild(div);
    document.getElementById("chatContainer").scrollTop = 9999;
}

// -------------------- CHAT INPUT --------------------
document
    .getElementById("chatInput")
    .addEventListener("keypress", function (e) {
        if (e.key === "Enter" && this.value.trim() !== "") {
            addChat(this.value, false);
            this.value = "";
        }
    });
