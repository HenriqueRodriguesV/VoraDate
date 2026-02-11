// -------------------- DASHBOARD / FORECAST LSTM --------------------

// Instâncias dos gráficos
let chartHistoryForecast = null;
let chartForecastOnly = null;
let chartForecastSummary = null;  // Indicadores (mín/méd/máx)
let chartForecastChange = null;   // Variação %

// Estado de fullscreen
let fullscreenOverlay = null;
let fullscreenInner = null;
let fullscreenActiveCard = null;
const chartOriginalPositions = new WeakMap();

function appendToTerminal(line) {
    const term = document.getElementById("terminalOutput");
    if (!term) return;
    const div = document.createElement("div");
    div.className = "mb-1";
    div.textContent = line;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

async function runLstmForecast() {
    const { email } = getUserMeta();

    // Sempre tenta usar o arquivo limpo primeiro; se não tiver, cai pro original
    const filenameForForecast = lastCleanedFileName || lastUploadedFileName;

    if (!filenameForForecast) {
        showToast("Faça upload de um dataset (e, de preferência, aplique a limpeza) antes de rodar o forecast.");
        if (typeof switchAppTab === "function") {
            switchAppTab("data");
        }
        return;
    }

    if (typeof switchAppTab === "function") {
        switchAppTab("terminal");
    }

    appendToTerminal(`$ vora-lstm --file ${filenameForForecast}`);
    appendToTerminal("Iniciando treino do modelo LSTM...");

    try {
        const resp = await fetch("http://127.0.0.1:8000/api/forecast/lstm", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                filename: filenameForForecast,
                user_email: email,
            }),
        });

        if (!resp.ok) {
            const msg = await resp.text();
            appendToTerminal(`Erro HTTP: ${resp.status} - ${msg}`);
            showToast("Erro ao rodar o modelo no backend.");
            return;
        }

        const data = await resp.json();
        appendToTerminal("Treino concluído. Atualizando dashboard...");
        updateDashboardFromForecast(data);
        showToast("Forecast LSTM concluído com sucesso.");
    } catch (err) {
        console.error(err);
        appendToTerminal("Falha na comunicação com o backend.");
        showToast("Não foi possível comunicar com o backend.");
    }
}

function updateDashboardFromForecast(payload) {
    if (!payload || !payload.ok) {
        showToast("Resposta inválida do backend de forecast.");
        return;
    }

    const placeholder = document.getElementById("graphPlaceholder");
    const metricsPanel = document.getElementById("metricsPanel");
    const chartsPanel = document.getElementById("chartsPanel");

    if (placeholder) placeholder.classList.add("hidden");
    if (metricsPanel) metricsPanel.classList.remove("hidden");
    if (chartsPanel) chartsPanel.classList.remove("hidden");

    if (typeof switchAppTab === "function") {
        switchAppTab("graph");
    }

    const metrics = payload.metrics || {};
    const rmseEl = document.getElementById("metric-rmse");
    const maeEl = document.getElementById("metric-mae");
    const epochsEl = document.getElementById("metric-epochs");

    if (rmseEl && metrics.rmse != null) {
        rmseEl.textContent = Number(metrics.rmse).toFixed(2);
    }
    if (maeEl && metrics.mae != null) {
        maeEl.textContent = Number(metrics.mae).toFixed(2);
    }
    if (epochsEl && metrics.train_epochs != null) {
        epochsEl.textContent = String(metrics.train_epochs);
    }

    const history = (payload.history || []).map((p) => ({
        t: new Date(p.date),
        y: Number(p.value),
    }));
    const forecast = (payload.forecast || []).map((p) => ({
        t: new Date(p.date),
        y: Number(p.value),
    }));

    renderForecastCharts(history, forecast);
}

// --------- helper para reduzir número de pontos ---------
function downsamplePoints(points, maxPoints) {
    if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
    const step = Math.max(1, Math.floor(points.length / maxPoints));
    const result = [];
    for (let i = 0; i < points.length; i += step) {
        result.push(points[i]);
    }
    return result;
}

function renderForecastCharts(history, forecast) {
    const ctx1El = document.getElementById("chart-history-forecast");
    const ctx2El = document.getElementById("chart-forecast-only");
    const ctx3El = document.getElementById("chart-forecast-summary"); // indicadores
    const ctx4El = document.getElementById("chart-forecast-change");  // variação %

    if (!ctx1El || !ctx2El) return;

    const ctx1 = ctx1El.getContext("2d");
    const ctx2 = ctx2El.getContext("2d");

    // Downsample – deixa no máximo 400 pontos de histórico e 60 de forecast
    history = downsamplePoints(history || [], 400);
    forecast = downsamplePoints(forecast || [], 60);

    const historyLabels = history.map((p) =>
        p.t instanceof Date ? p.t.toISOString().substring(0, 10) : String(p.t)
    );
    const historyValues = history.map((p) => Number(p.y));

    const forecastLabels = forecast.map((p) =>
        p.t instanceof Date ? p.t.toISOString().substring(0, 10) : String(p.t)
    );
    const forecastValues = forecast.map((p) => Number(p.y));

    // destrói gráficos antigos se existirem
    if (chartHistoryForecast) chartHistoryForecast.destroy();
    if (chartForecastOnly) chartForecastOnly.destroy();
    if (chartForecastSummary) chartForecastSummary.destroy();
    if (chartForecastChange) chartForecastChange.destroy();

    // ---------- 1) Histórico + Forecast (linha suave) ----------
    chartHistoryForecast = new Chart(ctx1, {
        type: "line",
        data: {
            labels: [...historyLabels, ...forecastLabels],
            datasets: [
                {
                    label: "Histórico",
                    data: [
                        ...historyValues,
                        ...Array(forecastValues.length).fill(null),
                    ],
                    borderColor: "rgba(59,130,246,1)",
                    backgroundColor: "rgba(59,130,246,0.08)",
                    tension: 0.25,
                    borderWidth: 1.8,
                    pointRadius: 0,
                    spanGaps: true,
                },
                {
                    label: "Forecast",
                    data: [
                        ...Array(historyValues.length).fill(null),
                        ...forecastValues,
                    ],
                    borderColor: "rgba(239,68,68,1)",
                    backgroundColor: "rgba(239,68,68,0.1)",
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: forecastValues.length > 40 ? 0 : 2,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        font: { family: "Inter", size: 10 },
                        color: "#e5e7eb",
                    },
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        label: (ctx) =>
                            `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        font: { family: "JetBrains Mono", size: 9 },
                        color: "#9ca3af",
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    ticks: {
                        font: { family: "JetBrains Mono", size: 9 },
                        color: "#9ca3af",
                    },
                    grid: {
                        color: "rgba(148,163,184,0.1)",
                    },
                },
            },
        },
    });

    // ---------- 2) Somente horizonte previsto (linha) ----------
    chartForecastOnly = new Chart(ctx2, {
        type: "line",
        data: {
            labels: forecastLabels,
            datasets: [
                {
                    label: "Forecast",
                    data: forecastValues,
                    borderColor: "rgba(59,130,246,1)",
                    backgroundColor: "rgba(59,130,246,0.12)",
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: forecastValues.length > 40 ? 0 : 3,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        label: (ctx) => ctx.parsed.y.toFixed(2),
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        font: { family: "JetBrains Mono", size: 9 },
                        color: "#9ca3af",
                    },
                    grid: {
                        display: false,
                    },
                },
                y: {
                    ticks: {
                        font: { family: "JetBrains Mono", size: 9 },
                        color: "#9ca3af",
                    },
                    grid: {
                        color: "rgba(148,163,184,0.1)",
                    },
                },
            },
        },
    });

    // ---------- 3) Indicadores-chave (Mín / Méd / Máx) ----------
    if (ctx3El && forecastValues.length > 0) {
        const ctx3 = ctx3El.getContext("2d");

        const minVal = Math.min(...forecastValues);
        const maxVal = Math.max(...forecastValues);
        const sumVal = forecastValues.reduce((acc, v) => acc + v, 0);
        const meanVal = sumVal / forecastValues.length;

        chartForecastSummary = new Chart(ctx3, {
            type: "bar",
            data: {
                labels: ["Mínimo", "Média", "Máximo"],
                datasets: [
                    {
                        label: "Indicadores da previsão",
                        data: [minVal, meanVal, maxVal],
                        borderWidth: 1.8,
                        borderColor: [
                            "rgba(59,130,246,1)",
                            "rgba(139,92,246,1)",
                            "rgba(56,189,248,1)",
                        ],
                        backgroundColor: [
                            "rgba(59,130,246,0.25)",
                            "rgba(139,92,246,0.35)",
                            "rgba(56,189,248,0.35)",
                        ],
                        borderRadius: 6,
                        maxBarThickness: 40,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ctx.parsed.y.toFixed(2),
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            font: { family: "Inter", size: 10 },
                            color: "#9ca3af",
                        },
                        grid: { display: false },
                    },
                    y: {
                        ticks: {
                            font: { family: "JetBrains Mono", size: 9 },
                            color: "#9ca3af",
                        },
                        grid: {
                            color: "rgba(148,163,184,0.1)",
                        },
                    },
                },
            },
        });
    }

    // ---------- 4) Variação % vs último valor real ----------
    if (ctx4El && forecastValues.length > 0 && historyValues.length > 0) {
        const lastHistoryVal = historyValues[historyValues.length - 1];

        if (lastHistoryVal !== 0) {
            const ctx4 = ctx4El.getContext("2d");
            const changePerc = forecastValues.map(
                (v) => ((v - lastHistoryVal) / lastHistoryVal) * 100
            );

            const changeColors = changePerc.map((p) =>
                p >= 0
                    ? "rgba(34,197,94,0.35)"   // verde para alta
                    : "rgba(239,68,68,0.35)"   // vermelho para queda
            );
            const changeBorderColors = changePerc.map((p) =>
                p >= 0
                    ? "rgba(34,197,94,1)"
                    : "rgba(239,68,68,1)"
            );

            chartForecastChange = new Chart(ctx4, {
                type: "bar",
                data: {
                    labels: forecastLabels,
                    datasets: [
                        {
                            label: "Variação % vs último valor real",
                            data: changePerc,
                            borderWidth: 1.2,
                            borderColor: changeBorderColors,
                            backgroundColor: changeColors,
                            borderRadius: 3,
                            maxBarThickness: 36,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) =>
                                    `${ctx.parsed.y.toFixed(2)}%`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: {
                                maxTicksLimit: 8,
                                font: { family: "JetBrains Mono", size: 9 },
                                color: "#9ca3af",
                            },
                            grid: { display: false },
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                font: { family: "JetBrains Mono", size: 9 },
                                color: "#9ca3af",
                                callback: (value) => `${value}%`,
                            },
                            grid: {
                                color: "rgba(148,163,184,0.1)",
                            },
                        },
                    },
                },
            });
        }
    }
}

// -------------------- FULLSCREEN DE GRÁFICO --------------------

// Cria overlay de fullscreen se ainda não existir
function ensureFullscreenOverlay() {
    if (fullscreenOverlay) return;

    fullscreenOverlay = document.createElement("div");
    fullscreenOverlay.id = "vora-chart-fullscreen-overlay";
    fullscreenOverlay.className =
        "fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm hidden items-center justify-center";

    fullscreenOverlay.innerHTML = `
        <div class="relative w-full h-full max-w-none max-h-none bg-dynamic-surface border border-dynamic md:rounded-xl p-4 shadow-2xl flex flex-col" data-fullscreen-inner-wrapper>
            <div class="flex justify-between items-center mb-2">
                <h4 id="vora-chart-fullscreen-title" class="text-xs font-bold text-dynamic-main uppercase tracking-wide"></h4>
                <div class="flex items-center gap-2">
                    <span class="hidden md:inline text-[10px] text-dynamic-dim">ESC para sair</span>
                    <button type="button" class="p-1 rounded hover:bg-white/10 text-dynamic-dim" data-fullscreen-close>
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
            <div class="flex-1 min-h-[320px] flex">
                <div class="flex-1 min-h-[320px]" data-fullscreen-inner></div>
            </div>
        </div>
    `;

    document.body.appendChild(fullscreenOverlay);

    fullscreenInner = fullscreenOverlay.querySelector("[data-fullscreen-inner]");
    const closeBtn = fullscreenOverlay.querySelector("[data-fullscreen-close]");

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            closeChartFullscreen();
        });
    }

    fullscreenOverlay.addEventListener("click", (evt) => {
        if (evt.target === fullscreenOverlay) {
            closeChartFullscreen();
        }
    });

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}

function openChartFullscreenByCanvasId(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const card = canvas.closest(".bg-dynamic-panel");
    if (!card) return;

    ensureFullscreenOverlay();

    if (!chartOriginalPositions.has(card)) {
        chartOriginalPositions.set(card, {
            parent: card.parentNode,
            nextSibling: card.nextSibling,
        });
    }

    fullscreenActiveCard = card;

    const titleEl = fullscreenOverlay.querySelector("#vora-chart-fullscreen-title");
    const sourceTitle = card.querySelector("h4");
    if (titleEl) {
        titleEl.textContent = sourceTitle ? sourceTitle.textContent : "Gráfico";
    }

    fullscreenInner.innerHTML = "";
    fullscreenInner.appendChild(card);

    fullscreenOverlay.classList.remove("hidden");
    fullscreenOverlay.classList.add("flex");

    // trava scroll da página enquanto estiver fullscreen
    document.body.classList.add("overflow-hidden");

    // força os charts a recalcularem layout no novo tamanho
    setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
    }, 50);
}

function closeChartFullscreen() {
    if (fullscreenActiveCard) {
        const pos = chartOriginalPositions.get(fullscreenActiveCard);
        if (pos && pos.parent) {
            if (pos.nextSibling && pos.nextSibling.parentNode === pos.parent) {
                pos.parent.insertBefore(fullscreenActiveCard, pos.nextSibling);
            } else {
                pos.parent.appendChild(fullscreenActiveCard);
            }
        }
        fullscreenActiveCard = null;
    }

    if (fullscreenOverlay) {
        fullscreenOverlay.classList.add("hidden");
        fullscreenOverlay.classList.remove("flex");
    }

    // libera scroll
    document.body.classList.remove("overflow-hidden");

    // reajusta layout dos charts
    setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
    }, 50);
}

// ESC fecha fullscreen
document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") {
        closeChartFullscreen();
    }
});

// Adiciona botão de fullscreen no cabeçalho do card
function attachFullscreenButton(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const card = canvas.closest(".bg-dynamic-panel");
    if (!card) return;

    const header = card.querySelector(".flex.justify-between.items-center");
    if (!header) return;

    // evita criar duplicado
    if (header.querySelector("[data-fullscreen-btn]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-fullscreen-btn", "true");
    btn.className =
        "p-1 rounded hover:bg-white/10 text-dynamic-dim ml-2 transition-colors";
    btn.innerHTML = '<i data-lucide="maximize-2" class="w-4 h-4"></i>';

    btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        openChartFullscreenByCanvasId(canvasId);
    });

    header.appendChild(btn);

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}

// Liga o botão "> INICIAR ANÁLISE" ao forecast e fullscreen nos gráficos
document.addEventListener("DOMContentLoaded", () => {
    const runBtn = document.getElementById("runBtn");
    if (runBtn) {
        runBtn.classList.remove("cursor-default");
        runBtn.classList.add("cursor-pointer");
        runBtn.addEventListener("click", () => {
            runLstmForecast();
        });
    }

    // Botões de tela cheia para cada gráfico
    attachFullscreenButton("chart-history-forecast");
    attachFullscreenButton("chart-forecast-only");
    attachFullscreenButton("chart-forecast-summary");
    attachFullscreenButton("chart-forecast-change");
});
