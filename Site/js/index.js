lucide.createIcons();

// --- THEME STATE ---
const userSettings = { darkMode: true };

const menuToggle = document.getElementById('menu-toggle');
const sidebarMenu = document.getElementById('sidebar-menu');
let isMenuOpen = false;

const header = document.getElementById('main-header');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
});

menuToggle?.addEventListener('click', () => {
    isMenuOpen = !isMenuOpen;
    if (isMenuOpen) {
        menuToggle.classList.add('active');
        sidebarMenu.classList.add('open');
    } else {
        menuToggle.classList.remove('active');
        sidebarMenu.classList.remove('open');
    }
});

function scrollToSection(id) {
    if (isMenuOpen) menuToggle.click();
    document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

// --- AUTH LOGIC (LOGIN / REGISTER) ---
function openLogin() {
    toggleAuthMode('login');
    showAuthModal();
}

function openRegister() {
    toggleAuthMode('register');
    showAuthModal();
}

function showAuthModal() {
    if (isMenuOpen) menuToggle.click();
    const userMenu = document.getElementById('user-dropdown');
    if (userMenu && !userMenu.classList.contains('hidden')) userMenu.classList.add('hidden');

    document.getElementById('landing-page').style.display = 'block';
    document.getElementById('login-view').style.display = 'flex';
    if (menuToggle) menuToggle.style.display = 'none';
    initNeuralNetwork();
}

function toggleAuthMode(mode) {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    if (mode === 'login') {
        loginForm.classList.remove('hidden-form');
        loginForm.classList.add('visible-form');
        regForm.classList.remove('visible-form');
        regForm.classList.add('hidden-form');

        title.innerText = "Bem-vindo ao VORA";
        subtitle.innerText = "Faça login para acessar a plataforma.";
    } else {
        loginForm.classList.remove('visible-form');
        loginForm.classList.add('hidden-form');
        regForm.classList.remove('hidden-form');
        regForm.classList.add('visible-form');

        title.innerText = "Crie sua conta";
        subtitle.innerText = "Comece a prever o futuro do seu negócio.";
    }
}

// 🔥 LOGIN + REGISTER VIA API
function handleAuthSubmit(type) {
    // -------- LOGIN --------
    if (type === 'login') {
        const email = document.getElementById('login-email').value.trim();
        const pass = document.getElementById('login-password').value.trim();

        if (!email || !pass) {
            showToast('Por favor, preencha todos os campos.');
            return;
        }

        const btn = document.getElementById('login-btn');
        const originalText = btn.innerText;

        btn.innerHTML = '<div class="v-spinner-sm">V</div>';
        btn.disabled = true;

        fetch("http://127.0.0.1:8000/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email,
                senha: pass
            })
        })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.ok) {
                // >>> SALVA A SESSÃO DO USUÁRIO PARA USAR NA PLATAFORMA
                const userFromApi = data.user || data.usuario || {};
                const userSession = {
                    email: userFromApi.email || email,
                    nome: userFromApi.nome 
                    || userFromApi.name 
                    || userFromApi.username 
                    || (email.split('@')[0])
                };

                // chave única da sessão do VORA
                localStorage.setItem('voraUser', JSON.stringify(userSession));
                // <<< FIM DA PARTE DE SESSÃO

                showToast("Login realizado com sucesso!");
                setTimeout(() => {
                    window.location.href = "plataforma.html";
                }, 800);
            } else {
                showToast(data.detail || "Credenciais inválidas");
            }
        })

        .catch(err => {
            console.error("Erro ao conectar:", err);
            showToast("Erro ao conectar com a API.");
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerText = originalText;
        });

        return;
    }

    // -------- REGISTER --------
    if (type === 'register') {
        const nome = document.getElementById('reg-name').value.trim();
        const sobrenome = document.getElementById('reg-lastname').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const senha = document.getElementById('reg-pass').value.trim();

        if (!nome || !sobrenome || !email || !senha) {
            showToast('Preencha todos os campos.');
            return;
        }

        if (senha.length < 8) {
            showToast('A senha deve ter pelo menos 8 caracteres.');
            return;
        }

        if (senha.length > 72) {
            showToast('A senha deve ter no máximo 72 caracteres.');
            return;
        }

        const btn = document.getElementById('register-btn');
        const originalText = btn.innerText;

        btn.disabled = true;
        btn.innerHTML = '<div class="v-spinner-sm">V</div>';

        fetch("http://127.0.0.1:8000/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email,
                senha: senha
            })
        })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                showToast("Conta criada com sucesso! Faça login para continuar.");
                setTimeout(() => {
                    toggleAuthMode('login');
                }, 1000);
            } else {
                showToast(data.detail || "Erro ao criar conta.");
            }
        })
        .catch(err => {
            console.error("Erro ao registrar:", err);
            showToast("Erro ao conectar com a API.");
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerText = originalText;
        });

        return;
    }

    // -------- GOOGLE (ainda fake) --------
    if (type === 'google') {
        doFakeLoading(null, 'Autenticando com Google...');
        return;
    }
}

function doFakeLoading(btnId, msg) {
    showToast(msg || 'Processando.');

    // salva um usuário demo só para testar a plataforma
    localStorage.setItem('voraUser', JSON.stringify({
        email: 'demo@vora.ai',
        nome: 'Demo User'
    }));

    setTimeout(() => { window.location.href = 'plataforma.html'; }, 1500);
}


function closeApp() {
    document.getElementById('landing-page').style.display = 'block';
    document.getElementById('login-view').style.display = 'none';
    if (menuToggle) menuToggle.style.display = '';
}

// USER MENU (não usado mais visualmente, mas mantido para compatibilidade caso algo referencie)
function toggleUserMenu() {
    const menu = document.getElementById('user-dropdown');
    const chevron = document.getElementById('user-chevron');
    if (!menu || !chevron) return;

    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        menu.classList.add('scale-enter');
        chevron.style.transform = 'rotate(180deg)';
    } else {
        menu.classList.add('hidden');
        menu.classList.remove('scale-enter');
        chevron.style.transform = 'rotate(0deg)';
    }
}

document.addEventListener('click', function (event) {
    const container = document.getElementById('user-menu-container');
    const menu = document.getElementById('user-dropdown');
    const chevron = document.getElementById('user-chevron');

    // Deixa seguro mesmo sem o menu existir
    if (container && menu && !menu.classList.contains('hidden') && !container.contains(event.target)) {
        menu.classList.add('hidden');
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
    }
});

// SETTINGS
const appActions = {
    openSettings: () => {
        const html = `
            <h3 class="text-lg font-bold mb-4 flex items-center gap-2 text-dynamic-main">
                <i data-lucide="settings" class="w-5 h-5 text-accent"></i> Configurações
            </h3>
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <span class="text-sm text-dynamic-main font-medium">Modo Escuro</span>
                    <div onclick="toggleSwitch(this, 'darkMode')" class="w-10 h-5 ${userSettings.darkMode ? 'bg-accent' : 'bg-gray-400'} rounded-full relative cursor-pointer transition-colors shadow-inner">
                        <div class="absolute ${userSettings.darkMode ? 'right-1' : 'left-1'} top-1 w-3 h-3 bg-white rounded-full transition-all duration-200 shadow-sm"></div>
                    </div>
                </div>
                <button onclick="closeModal()" class="w-full mt-6 bg-dynamic-surface text-dynamic-main hover:opacity-90 py-2 rounded-lg transition-colors font-bold text-sm border border-dynamic">
                    Salvar Alterações
                </button>
            </div>
        `;
        openModal(html);
    }
};

function toggleSwitch(el, key) {
    const isActive = !userSettings[key];
    userSettings[key] = isActive;
    const knob = el.querySelector('div');

    if (isActive) {
        el.classList.remove('bg-gray-400');
        el.classList.add('bg-accent');
        knob.classList.remove('left-1');
        knob.classList.add('right-1');
    } else {
        el.classList.remove('bg-accent');
        el.classList.add('bg-gray-400');
        knob.classList.remove('right-1');
        knob.classList.add('left-1');
    }

    applySettingEffect(key, isActive);
}

function applySettingEffect(key, isActive) {
    if (key === 'darkMode') {
        const root = document.documentElement;
        if (isActive) {
            root.style.setProperty('--bg-core', '#0A0A0C');
            root.style.setProperty('--bg-panel', 'rgba(21, 21, 26, 0.95)');
            root.style.setProperty('--bg-surface', 'rgba(13, 13, 17, 0.8)');
            root.style.setProperty('--bg-card', 'rgba(20, 20, 25, 0.6)');
            root.style.setProperty('--bg-input', 'rgba(0,0,0,0.3)');
            root.style.setProperty('--border-std', 'rgba(255, 255, 255, 0.08)');
            root.style.setProperty('--text-main', '#E2E8F0');
            root.style.setProperty('--text-dim', '#94a3b8');
            root.style.setProperty('--shadow-color', 'rgba(0, 0, 0, 0.5)');
            root.style.setProperty('--bg-popular-card', '#15121F');
        } else {
            root.style.setProperty('--bg-core', '#F8FAFC');
            root.style.setProperty('--bg-panel', 'rgba(255, 255, 255, 0.95)');
            root.style.setProperty('--bg-surface', '#FFFFFF');
            root.style.setProperty('--bg-card', 'rgba(255, 255, 255, 0.8)');
            root.style.setProperty('--bg-input', '#F1F5F9');
            root.style.setProperty('--border-std', '#E2E8F0');
            root.style.setProperty('--text-main', '#0F172A');
            root.style.setProperty('--text-dim', '#64748B');
            root.style.setProperty('--shadow-color', 'rgba(0, 0, 0, 0.1)');
            root.style.setProperty('--bg-popular-card', '#FFFFFF');
        }
        showToast(`Modo Escuro ${isActive ? 'Ativado' : 'Desativado'}`);
    }
}

// === BOTÃO DIRETO DE MODO CLARO / ESCURO NO HEADER ===
function toggleThemeQuick() {
    const newState = !userSettings.darkMode;
    userSettings.darkMode = newState;
    applySettingEffect('darkMode', newState);

    const label = document.getElementById('theme-toggle-label');
    const iconEl = document.getElementById('theme-toggle-icon');

    if (label) {
        label.textContent = newState ? 'Modo Escuro' : 'Modo Claro';
    }
    if (iconEl) {
        iconEl.setAttribute('data-lucide', newState ? 'moon' : 'sun');
        lucide.createIcons();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const label = document.getElementById('theme-toggle-label');
    const iconEl = document.getElementById('theme-toggle-icon');

    if (label) {
        label.textContent = userSettings.darkMode ? 'Modo Escuro' : 'Modo Claro';
    }
    if (iconEl) {
        iconEl.setAttribute('data-lucide', userSettings.darkMode ? 'moon' : 'sun');
        lucide.createIcons();
    }
});

// MODAL
const modal = document.getElementById('sys-modal');
const modalBody = document.getElementById('modal-body');

function openModal(html) {
    modalBody.innerHTML = html;
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    lucide.createIcons();
}

function closeModal() {
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

// ANIMAÇÃO (NEURAL NETWORK)
function initNeuralNetwork() {
    const canvas = document.getElementById('neural-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height, particles = [];
    const particleCount = 60, connectionDistance = 150;

    function resize() {
        width = canvas.width = canvas.parentElement.offsetWidth;
        height = canvas.height = canvas.parentElement.offsetHeight;
    }

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.5;
            this.vy = (Math.random() - 0.5) * 0.5;
            this.size = Math.random() * 2 + 1;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139, 92, 246, 0.5)';
            ctx.fill();
        }
    }

    function init() {
        resize();
        particles = [];
        for (let i = 0; i < particleCount; i++) particles.push(new Particle());
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            for (let j = i; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < connectionDistance) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(139, 92, 246, ${1 - dist / connectionDistance})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    init();
    animate();
}

// --- CONTATO (FUNCIONANDO VIA API) ---
async function handleContactSubmit(event) {
    event.preventDefault();

    console.log("Enviando para API de contato...");

    const nome = document.getElementById("contact-nome").value.trim();
    const empresa = document.getElementById("contact-empresa").value.trim();
    const email = document.getElementById("contact-email").value.trim();
    const mensagem = document.getElementById("contact-mensagem").value.trim();
    const btn = document.getElementById("contact-submit-btn");

    if (!nome || !email || !mensagem) {
        showToast("Preencha nome, email e mensagem.");
        return;
    }

    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = "Enviando...";

    try {
        const resp = await fetch("http://127.0.0.1:8000/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, empresa, email, mensagem }),
        });

        const data = await resp.json().catch(() => ({}));

        if (resp.ok && data.ok) {
            event.target.reset();
            showToast("Mensagem enviada com sucesso!");
        } else {
            showToast("Erro ao enviar mensagem.");
        }
    } catch (err) {
        console.error("Erro de conexão:", err);
        showToast("Falha ao conectar ao servidor.");
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
