# AgentFlow Sales Site — Complete Specification
# Product Owner Spec Document
# Target: /home/projetos/agentes-vendas/index.html
# Date: 2026-02-28

---

## PRODUCT OVERVIEW

**Product Name:** AgentFlow (based on Agents-Orchestrator v1.1.0)
**Repository:** /home/projetos/Agents-Orchestrator
**Target Sales Site Dir:** /home/projetos/agentes-vendas
**Language:** Portuguese (Brazil)
**Existing Reference:** /home/projetos/agen/index.html (2648 lines — existing landing page)
**Reference Design System:** /home/projetos/agen/DESIGN_SYSTEM.md
**Reference Copy:** /home/projetos/agen/LANDING_PAGE_COPY.md

---

## PRODUCT CAPABILITIES (for copywriting)

1. Visual orchestration of multiple Claude AI agents via web interface
2. Visual drag-and-drop editor for sequential pipelines
3. Real-time terminal with streaming agent output (WebSocket)
4. Automatic task scheduling via cron expressions
5. Native Gitea integration (auto-commit/push)
6. Webhooks for integration with external systems (HMAC-SHA256 signed)
7. Dashboard with metrics, interactive charts (Chart.js), execution history
8. Feature flags and granular per-agent settings
9. Multi-agent support with coordination and automatic delegation
10. Self-hosted, open-source (MIT), zero cloud service dependency
11. Docker deploy in one command with automatic HTTPS via Caddy
12. Human-in-the-loop approval gates in pipelines
13. Export/import agent configurations as JSON
14. File explorer with publish-to-subdomain feature
15. Task catalog with 6 templates (Code Review, Security, Refactoring, Tests, Docs, Performance)
16. Redis cache support (optional L2 cache)
17. Bearer token auth, rate limiting, CORS protection, path traversal protection

---

## DESIGN SYSTEM (to be used exactly)

### Color Palette

```css
:root {
  --color-bg-primary: #09090B;
  --color-bg-secondary: #111113;
  --color-bg-tertiary: #18181B;
  --color-bg-elevated: #1E1E22;
  --color-bg-glass: rgba(17, 17, 19, 0.72);
  --color-bg-code: #0D0D10;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-border-subtle: rgba(255, 255, 255, 0.04);
  --color-border-hover: rgba(255, 255, 255, 0.14);
  --color-border-active: rgba(99, 102, 241, 0.4);
  --color-text-primary: #FAFAFA;
  --color-text-secondary: #A1A1AA;
  --color-text-muted: #71717A;
  --color-text-ghost: #52525B;
  --color-accent-primary: #6366F1;
  --color-accent-primary-hover: #818CF8;
  --color-accent-primary-dark: #4F46E5;
  --color-accent-glow: rgba(99, 102, 241, 0.15);
  --color-accent-glow-strong: rgba(99, 102, 241, 0.30);
  --color-accent-secondary: #8B5CF6;
  --color-accent-tertiary: #22D3EE;
  --color-success: #22C55E;
  --color-warning: #EAB308;
  --color-error: #EF4444;
  --gradient-hero: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.08) 40%, transparent 70%);
  --gradient-text-hero: linear-gradient(135deg, #FAFAFA 0%, #C7D2FE 40%, #818CF8 70%, #8B5CF6 100%);
  --gradient-cta: linear-gradient(135deg, #6366F1 0%, #7C3AED 100%);
}
```

### Typography
- Display/Headlines: Inter (400, 500, 600, 700)
- Body: Inter
- Code/Terminal: JetBrains Mono (400, 500)
- Google Fonts: https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap

### Stack
- Pure HTML/CSS/JavaScript (no frameworks, no bundlers)
- SINGLE index.html file with embedded CSS and JS
- CSS custom properties for theming
- IntersectionObserver for scroll animations
- CSS transforms for parallax
- requestAnimationFrame for counters/animations

---

## SITE STRUCTURE — ALL PAGES

The site is a SINGLE PAGE (index.html) with multiple sections.

### Section Order:
1. Navbar (sticky, glassmorphism on scroll)
2. Hero Section
3. Social Proof / Compatibility Bar (logos)
4. Value Proposition (3 pillars)
5. How It Works (3 steps)
6. Features Detail (4 groups / tabs)
7. Terminal Demo (animated)
8. Testimonials (3 cards)
9. Stats / Impact Metrics (animated counters)
10. Pricing (3 tiers)
11. FAQ (accordion, 8 questions)
12. Final CTA Section
13. Footer

---

## SECTION SPECIFICATIONS

### 1. NAVBAR
- Logo: SVG icon + "AgentFlow" wordmark
- Links: Features | Pipelines | Pricing | FAQ
- CTA button: "Comecar" → https://agents.nitro-cloud.duckdns.org/
- GitHub link with GitHub icon → https://git.nitro-cloud.duckdns.org/fred/Agents-Orchestrator
- Mobile hamburger menu with slide-in drawer
- On scroll: glassmorphism background + border bottom appears
- WCAG: aria-label, aria-expanded, skip-to-content link

### 2. HERO SECTION
- Badge: "Open Source · Orquestração Multi-Agente IA"
- H1: "Controle seus agentes IA em um painel."
- Subheadline: "Crie, configure e execute múltiplos agentes Claude Code a partir de uma interface visual única. Pipelines automatizados, scheduling com cron, terminal em tempo real e métricas de custo — tudo em um deploy."
- CTA Primary: "[Instalar Agora — é Gratuito]"
- CTA Secondary: "[Ver no GitHub]" + "[Explorar a Demo]"
- Micro copy: "Deploy em um único comando. Self-hosted. Sem cartão de crédito."
- Social Proof Bar: 3 columns — MIT Open Source | Deploy < 2 min com Docker | Agentes Simultâneos: Sem Limite
- Hero visual: Animated mock dashboard card showing agents running
- Background: radial gradient glow from top + subtle grid pattern
- PARALLAX: The glow orb in background shifts on scroll
- Entrance animations: badge fades in first, then H1, then subheadline, then CTAs, staggered

### 3. COMPATIBILITY BAR
- Title: "Integra com seu stack atual"
- Logos (SVG inline or text badges): Claude/Anthropic, Docker, Node.js, Caddy, Redis, GitHub, GitLab, Linux, VS Code, Slack
- Horizontal scroll marquee animation on mobile
- Subtle fade-in from sides

### 4. VALUE PROPOSITION (3 PILLARS)
- Section kicker: "Por que AgentFlow"
- H2: "Por que equipes técnicas escolhem o AgentFlow"
- 3 cards:
  - Card 1: icon(terminal) | "Orquestre agentes, não terminais" | desc
  - Card 2: icon(git-merge) | "Pipelines que pensam em sequência" | desc
  - Card 3: icon(bar-chart-2) | "Visibilidade total de custo e performance" | desc
- Cards have: glow border on hover, mouse-tracking gradient effect
- Staggered scroll animation (data-animate with delay)

### 5. HOW IT WORKS (3 STEPS)
- Section kicker: "Como funciona"
- H2: "Do deploy ao primeiro pipeline em 3 passos"
- Step 1: "Instale com um comando" + docker compose up -d code snippet
- Step 2: "Crie seus agentes" + description
- Step 3: "Monte pipelines e agende" + description
- Layout: numbered steps with connecting line/dots (vertical on mobile, visual flow)
- Code blocks styled with JetBrains Mono + syntax highlight colors

### 6. FEATURES DETAIL (TABS)
- Section kicker: "Features"
- H2: "Tudo que você precisa para gerenciar agentes IA em produção"
- Tab navigation: Agentes | Pipelines | Monitoramento | Infraestrutura
- Each tab shows 4 feature items with icon + title + description
- Tab panel switch animation
- Tab 1 (Agentes): Prompts customizados | Seleção de modelo | Diretórios isolados | Permissões granulares
- Tab 2 (Pipelines): Pipelines sequenciais | Templates prontos | Scheduling cron | Human-in-the-loop
- Tab 3 (Monitoramento): Terminal tempo real | Dashboard métricas | Ranking agentes | Histórico completo
- Tab 4 (Infraestrutura): Docker deploy | Webhooks HMAC | Export/Import JSON | Redis cache

### 7. TERMINAL DEMO
- Section kicker: "Demonstração"
- H2: "Veja o AgentFlow em ação"
- Animated terminal window showing a pipeline executing
- Terminal header with 3 colored dots (mac-style)
- Lines appear one by one with typewriter effect
- Content: pipeline with 3 agents (logic-reviewer, security-auditor, test-generator)
- Final line: "✓ Pipeline completo em 1m35s | Custo: $0.042 | Status: SUCCESS"
- Animation triggered by IntersectionObserver

### 8. TESTIMONIALS (3 CARDS)
- Section kicker: "Prova social"
- H2: "Quem já usa confia nos resultados"
- Card 1: Mariana Souza, Dev Lead na Kerno (Série A, 22 engenheiros) — code review quote
- Card 2: Rafael Mendes, DevOps Engineer na Dataside — scheduling/cost quote
- Card 3: Thiago Rios, CTO na Finova Sistemas (Fintech) — human-in-the-loop compliance quote
- Cards: avatar initial + name + role + quote
- Scroll-triggered fade-in with stagger

### 9. STATS / IMPACT METRICS
- Section kicker: "Impacto"
- H2: "Resultados medidos por equipes reais"
- 4 metrics with animated counters:
  - 83% — Redução no tempo de code review
  - 34h/mês — Economia média em horas de DevOps
  - 12 min — Tempo médio até o primeiro pipeline
  - 61% — Redução de incidentes de segurança
- Counters animate when scrolled into view
- Background: slightly elevated section

### 10. PRICING (3 TIERS)
- Section kicker: "Pricing"
- H2: "Escolha o plano que faz sentido para seu time"
- Subtitle: "O AgentFlow é open-source e sempre será..."
- Tier 1 (Community): Gratuito para sempre | 6 features | CTA: [Instalar Agora]
- Tier 2 (Pro): R$ 1.299/mês | 8 features | CTA: [Começar Trial de 14 Dias] — HIGHLIGHTED/FEATURED
- Tier 3 (Enterprise): Sob consulta | 8 features | CTA: [Falar com Vendas]
- Pro tier: accent border glow, "Mais Popular" badge

### 11. FAQ (ACCORDION)
- Section kicker: "FAQ"
- H2: "Perguntas frequentes"
- 8 questions with accordion animation:
  1. Preciso de uma API key da Anthropic?
  2. Quantos agentes posso criar simultaneamente?
  3. Os dados dos meus repositórios ficam seguros?
  4. Posso usar modelos diferentes para agentes diferentes?
  5. Como funciona o human-in-the-loop nos pipelines?
  6. O AgentFlow suporta alta disponibilidade (HA)?
  7. Como integro o AgentFlow com meu CI/CD pipeline existente?
  8. Qual a diferença entre o AgentFlow e usar o Claude Code diretamente no terminal?
- Smooth height animation on open/close
- Chevron icon rotates 180deg on open

### 12. FINAL CTA
- H2: "Seus agentes IA merecem um painel de controle."
- Subtext: "Instale o AgentFlow em menos de 2 minutos. Self-hosted, open-source, sem limites..."
- CTA: [Instalar Agora — Gratuito e Open Source]
- Micro copy: "Licença MIT. Sem trackers. Sem vendor lock-in. Código no GitHub."
- Background: subtle gradient overlay

### 13. FOOTER
- Logo + tagline
- 4 columns: Produto | Recursos | Empresa | Legal
- Links per column (can be # for now)
- Bottom bar: copyright + "Feito com dedicação para equipes de engenharia."
- Social links: GitHub icon

---

## ANIMATIONS & PARALLAX REQUIREMENTS

### Scroll Animations (IntersectionObserver)
- All section headers: fade up (translateY 30px → 0, opacity 0 → 1)
- Feature cards: staggered fade up (100ms delay between each)
- Testimonial cards: staggered fade left
- Stats counters: count up animation on intersect
- Terminal demo: typewriter on intersect

### Parallax Effects (CSS transform on scroll)
- Hero background glow orb: moves at 0.3x scroll speed (parallax depth)
- Hero H1 text: subtle 0.1x parallax (slight lift feel)
- Section dividers or decorative elements: 0.2x parallax

### Micro-interactions
- Feature cards: mouse-tracking gradient (--mouse-x, --mouse-y CSS vars)
- CTA buttons: shimmer/shine effect on hover
- Navbar links: underline slide animation
- FAQ accordion: smooth height transition
- Pricing cards: lift + glow on hover

### Performance constraints
- No heavy particle systems
- Parallax via CSS transforms only (no JS position tracking)
- Use will-change: transform sparingly
- requestAnimationFrame for counter animations
- prefers-reduced-motion media query must disable all animations

---

## ACCESSIBILITY REQUIREMENTS (WCAG 2.1 AA)

- Skip to main content link
- All interactive elements: visible focus ring
- Minimum contrast 4.5:1 for normal text
- Minimum contrast 3:1 for large text and UI components
- All images: descriptive alt text
- All icons: aria-hidden="true" (decorative) or aria-label (interactive)
- Buttons: clear accessible names
- FAQ accordion: aria-expanded, aria-controls
- Tabs: role="tablist", role="tab", aria-selected, aria-controls
- Mobile menu: aria-label, aria-expanded on toggle button
- Semantic HTML: proper heading hierarchy (h1 → h2 → h3)
- Form elements (if any): associated labels

---

## RESPONSIVENESS

### Breakpoints
- Mobile: < 640px
- Tablet: 640px – 1024px
- Desktop: > 1024px

### Mobile adaptations
- Navbar: hamburger menu, slide-in drawer
- Hero: single column, smaller font sizes (fluid type via clamp())
- Value props: single column cards
- Features tabs: horizontal scroll or vertical stack
- Testimonials: vertical stack
- Pricing: vertical stack (no 3-column grid)
- Footer: single column

---

## SEO META TAGS

```html
<title>AgentFlow — Dashboard para Orquestrar Agentes Claude Code | Open Source</title>
<meta name="description" content="Crie, configure e execute múltiplos agentes Claude Code a partir de uma interface visual. Pipelines multi-agente, scheduling com cron, terminal em tempo real e métricas de custo. Self-hosted, MIT, deploy em um comando.">
<meta name="keywords" content="claude code, agentes ia, orquestracao, multi-agente, dashboard, pipeline, devops, automacao, code review, anthropic, open source, self-hosted">
```

Plus Open Graph and Twitter Card tags (use og:image, og:description, etc.)

---

## TECHNICAL IMPLEMENTATION NOTES

- Single file: /home/projetos/agentes-vendas/index.html
- All CSS inline in <style> tag in <head>
- All JS inline in <script> tag before </body>
- No external JS dependencies (pure vanilla JS)
- Google Fonts: preconnect + stylesheet link
- Lucide icons: inline SVG (no external dependency)
- JSON-LD structured data: SoftwareApplication + FAQPage schemas
- Theme: dark only (no light mode toggle needed for sales site)

---

## LINKS TO USE

- Demo: https://agents.nitro-cloud.duckdns.org/
- Repo: https://git.nitro-cloud.duckdns.org/fred/Agents-Orchestrator
- Install: docker compose up -d (or git clone + npm start)
- License: MIT

---

## ACCEPTANCE CRITERIA

1. File exists at /home/projetos/agentes-vendas/index.html
2. All 13 sections present and populated with content
3. Parallax effect working on hero section background
4. Terminal demo animation triggers on scroll
5. Counter animations trigger on scroll
6. Feature tabs switching works
7. FAQ accordion expands/collapses smoothly
8. Mobile menu opens/closes correctly
9. Navbar gets glass effect on scroll
10. All CTAs point to correct URLs
11. Pricing section shows 3 tiers with Pro highlighted
12. WCAG 2.1 AA: skip link, focus styles, aria attributes, contrast
13. No horizontal scroll on any viewport
14. prefers-reduced-motion: all animations disabled
15. Valid HTML structure with proper heading hierarchy
16. JSON-LD structured data present

---

*Specification written by Product Owner. Date: 2026-02-28*
