/**
 * Design presets, imported from the linkedin-carousel reference repo.
 *
 * Data, not code: each preset is the font pairing and CSS custom properties
 * that define a look. Imported rather than read from the reference directory
 * at runtime so deleting that clone cannot break the app, and so the agent
 * can look one up by name instead of parsing markdown.
 */

export interface StudioPreset {
  id: string
  name: string
  vibe: string
  bestFor: string
  avoidFor: string
  /** Google Fonts <link> tag the preset expects. */
  fontsLink: string
  /** A :root { ... } block of CSS custom properties. */
  cssTokens: string
}

export const STUDIO_PRESETS: StudioPreset[] = [
  {
    "id": "crisp-navy-white",
    "name": "Crisp Navy & White",
    "vibe": "Authoritative, trusted, professional. The B2B standard done right — not boring.",
    "bestFor": "Industry analysis, PMS guides, tech comparisons, consulting insights, finance.",
    "avoidFor": "Lifestyle content, personal storytelling, anything that should feel casual.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #FFFFFF;\r\n  --surface:   #F4F6FA;\r\n  --surface-2: #E8ECF5;\r\n  --navy:      #1C3557;\r\n  --navy-lt:   #2C4F80;\r\n  --sky:       #4A79B5;\r\n  --gold:      #C28C14;\r\n  --gold-lt:   #E0A820;\r\n  --text:      #0F1E30;\r\n  --muted:     #627088;\r\n  --dim:       #A0B0C4;\r\n  --border:    #D8E0EC;\r\n  --warn-bg:   #FFF8F0;\r\n  --warn-bdr:  #F0DECA;\r\n  --warn-txt:  #C47020;\r\n  --serif: 'Lora', Georgia, serif;\r\n  --sans:  'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "warm-terracotta-cream",
    "name": "Warm Terracotta & Cream",
    "vibe": "Inviting, boutique, human. Premium without being cold.",
    "bestFor": "Hospitality, travel, food, personal branding, wellness, real estate, lifestyle.",
    "avoidFor": "Heavy technical content, finance, anything that needs to feel clinical.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Nunito:wght@300;400;500;600;700&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #FAF5EE;\r\n  --surface:   #F3EAE1;\r\n  --surface-2: #EBE0D4;\r\n  --terra:     #B8401E;\r\n  --terra-lt:  #D06040;\r\n  --amber:     #C88030;\r\n  --text:      #1C130E;\r\n  --muted:     #7A6050;\r\n  --dim:       #B8A898;\r\n  --border:    #DDD0BF;\r\n  --serif: 'Cormorant Garamond', Georgia, serif;\r\n  --sans:  'Nunito', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "sage-ivory",
    "name": "Sage & Ivory",
    "vibe": "Fresh, calm, contemporary. Clean without feeling sterile.",
    "bestFor": "Wellness, sustainability, coaching, HR, interior design, modern real estate, lifestyle brands.",
    "avoidFor": "Financial/legal content, anything that must project urgency or power.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #F8FAF6;\r\n  --surface:   #EDF2EA;\r\n  --surface-2: #E0EAD9;\r\n  --sage:      #3A6B52;\r\n  --sage-lt:   #5A8F70;\r\n  --sage-dim:  rgba(58,107,82,0.10);\r\n  --gold:      #B08820;\r\n  --text:      #1A2A20;\r\n  --muted:     #5A7060;\r\n  --dim:       #98B0A0;\r\n  --border:    #CCD9C5;\r\n  --serif: 'Fraunces', Georgia, serif;\r\n  --sans:  'Plus Jakarta Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "burgundy-editorial",
    "name": "Burgundy Editorial",
    "vibe": "Luxurious, premium, sophisticated. Editorial magazine meets high-end brand.",
    "bestFor": "Wine, luxury hotels, premium real estate, fashion, fine dining, wealth management.",
    "avoidFor": "Tech startups, youth brands, anything that should feel accessible or fun.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Libre+Franklin:wght@300;400;500;600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #FBF8F4;\r\n  --surface:   #F2EBE4;\r\n  --surface-2: #E8DDD5;\r\n  --burg:      #6B1E2E;\r\n  --burg-lt:   #902840;\r\n  --burg-dim:  rgba(107,30,46,0.08);\r\n  --gold:      #B07820;\r\n  --gold-lt:   #D4A030;\r\n  --text:      #1A0A10;\r\n  --muted:     #7A5A60;\r\n  --dim:       #B09898;\r\n  --border:    #DDD0C8;\r\n  --serif: 'Playfair Display', Georgia, serif;\r\n  --sans:  'Libre Franklin', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "slate-citrus",
    "name": "Slate & Citrus",
    "vibe": "Bold, modern, opinionated. A dark carousel that demands attention without going full tech-bro.",
    "bestFor": "Thought leadership, startup founders, provocative takes, tech, growth marketing, career advice.",
    "avoidFor": "Conservative industries, luxury, anything that must feel warm or approachable.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #1E2228;\r\n  --surface:   #282E36;\r\n  --surface-2: #313840;\r\n  --citrus:    #E8C030;\r\n  --citrus-lt: #F5D050;\r\n  --citrus-dim: rgba(232,192,48,0.12);\r\n  --coral:     #E06040;\r\n  --text:      #F0EDE8;\r\n  --muted:     #90A0A8;\r\n  --dim:       #58686F;\r\n  --border:    #38444C;\r\n  --serif: 'Syne', sans-serif;\r\n  --sans:  'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "graphite-ink",
    "name": "Graphite Ink",
    "vibe": "Pure minimal. Black-and-white editorial with surgical precision. Typography-first.",
    "bestFor": "Consulting, executive coaching, legal, high-end B2B, thought leadership with zero fluff.",
    "avoidFor": "Lifestyle, hospitality, anything that needs warmth or colour.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #FAFAFA;\r\n  --surface:   #F0F0F0;\r\n  --surface-2: #E4E4E4;\r\n  --ink:       #111111;\r\n  --ink-lt:    #2A2A2A;\r\n  --accent:    #111111;\r\n  --text:      #111111;\r\n  --muted:     #666666;\r\n  --dim:       #AAAAAA;\r\n  --border:    #DDDDDD;\r\n  --serif: 'Libre Baskerville', Georgia, serif;\r\n  --sans:  'Source Sans 3', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "electric-terminal",
    "name": "Electric Terminal",
    "vibe": "High-voltage digital, terminal authority. Inspired by the Hermes Agent UI (nousresearch.com). Electric blue + acid lime on near-black — impossible to scroll past.",
    "bestFor": "Tech founders, AI/SaaS thought leadership, product launches, provocative B2B takes, developer tools, growth hacking.",
    "avoidFor": "Luxury, wellness, warm lifestyle content, anything that must feel human or approachable.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #06060A;\r\n  --surface:   #0E0E18;\r\n  --surface-2: #14141F;\r\n  --electric:  #0000F2;\r\n  --electric-lt:#3333FF;\r\n  --electric-dim:rgba(0,0,242,0.12);\r\n  --lime:      #EDFF45;\r\n  --lime-lt:   #F5FF70;\r\n  --lime-dim:  rgba(237,255,69,0.08);\r\n  --text:      #F5F5F5;\r\n  --muted:     #8090A0;\r\n  --dim:       #40505A;\r\n  --border:    #1C1C2E;\r\n  --display: 'Space Grotesk', system-ui, sans-serif;\r\n  --mono:    'Courier Prime', 'Courier New', monospace;\r\n  --sans:    'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "periwinkle-coral",
    "name": "Periwinkle & Coral",
    "vibe": "Modern SaaS hospitality — clean, warm, and approachable without being generic. Directly inspired by Little Hotelier's brand system: indigo-violet primary with coral warmth. Feels like a polished product landing page.",
    "bestFor": "Hospitality SaaS, property management, booking technology, hotel operations content. Any SaaS-adjacent topic that needs to feel professional but human.",
    "avoidFor": "Heavy editorial or luxury content, anything that needs to feel dark/dramatic, B2B finance.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Epilogue:ital,wght@0,200;0,400;0,500;0,600;0,700;1,400;1,600&family=Lora:wght@500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:         #FFFFFF;\r\n  --surface:    #F0F2FF;\r\n  --surface-2:  #E4E7FF;\r\n  --indigo:     #525DDC;\r\n  --indigo-lt:  #6B75E8;\r\n  --indigo-dim: rgba(82,93,220,0.09);\r\n  --coral:      #FA7850;\r\n  --coral-lt:   #FF9272;\r\n  --coral-dim:  rgba(250,120,80,0.09);\r\n  --text:       #141414;\r\n  --muted:      #6C757D;\r\n  --dim:        #A0A8B0;\r\n  --border:     #E4E7FF;\r\n  --display: 'Epilogue', system-ui, sans-serif;\r\n  --serif:   'Lora', Georgia, serif;\r\n}"
  },
  {
    "id": "neo-brutalism",
    "name": "Neo-Brutalism",
    "vibe": "Raw, confrontational, impossible to ignore. The anti-polished aesthetic — stamp shadows, thick black borders, and primary colours treated as weapons. Inspired by current UI design trends (Figma's 2024 picks, ProductHunt award winners).",
    "bestFor": "Bold opinions, disruption narratives, contrarian takes, startup marketing critiques, anything meant to shock and stick.",
    "avoidFor": "Luxury, wellness, anything that should feel refined, warm, or approachable.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #FFFFFF;\r\n  --surface:  #F5F5F5;\r\n  --yellow:   #FFE500;\r\n  --red:      #FF2200;\r\n  --ink:      #000000;\r\n  --text:     #000000;\r\n  --muted:    #555555;\r\n  --display: 'Unbounded', sans-serif;\r\n  --mono:    'Space Mono', monospace;\r\n}"
  },
  {
    "id": "aurora-mesh",
    "name": "Aurora Mesh",
    "vibe": "Premium dark with living colour. Layered radial gradient \"aurora\" orbs create a sense of depth and energy. Glassmorphism hook panel floats over the bg. Inspired by current 2024–2026 dark SaaS/AI product landing pages.",
    "bestFor": "AI/ML, product launches, tech thought leadership, startup pitches, any content that needs to feel premium, futuristic, and warm at the same time.",
    "avoidFor": "Conservative B2B, legal/finance, luxury heritage brands, anything that needs to feel grounded or printed.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:          #08091A;\r\n  --surface:     rgba(255,255,255,0.06);\r\n  --purple:      #6433FF;\r\n  --teal:        #00DCB4;\r\n  --violet:      #DC50FF;\r\n  --text:        #FFFFFF;\r\n  --muted:       rgba(255,255,255,0.55);\r\n  --dim:         rgba(255,255,255,0.35);\r\n  --glass-bg:    rgba(255,255,255,0.06);\r\n  --glass-border:rgba(255,255,255,0.10);\r\n  --display: 'Outfit', sans-serif;\r\n  --sans:    'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "bento-grid",
    "name": "Bento Grid",
    "vibe": "App screenshot / product dashboard energy. The entire slide is a CSS grid of cards — no traditional slide anatomy at all. Inspired by Apple product pages and modern SaaS marketing sites.",
    "bestFor": "Product-led content, frameworks, systems thinking, anything that benefits from visual chunking. Tech, SaaS, productivity, design.",
    "avoidFor": "Story-heavy content, emotional narratives, anything linear — bento grids require scannable, chunk-friendly information.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #F0EEE9;\r\n  --white:    #FFFFFF;\r\n  --ink:      #1A1A1A;\r\n  --lime:     #B8F04A;\r\n  --muted:    #A0998E;\r\n  --dim:      #E8E6E1;\r\n  --display: 'Plus Jakarta Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "y2k-chrome",
    "name": "Y2K Chrome",
    "vibe": "Year-2000 maximalism reimagined. Holographic chrome gradient text (hot pink → cyan → white), cyber grid overlay, near-black bg, pink \"sticker\" hook box. References current 2024–2026 Y2K revival in design (seen across Figma community, Dribbble, Behance picks).",
    "bestFor": "Disruptive takes, provocative hooks, anything that benefits from visual shock. Tech marketing, growth, contrarian viewpoints.",
    "avoidFor": "Enterprise, luxury, anything that needs to feel trustworthy, professional, or European. Heavy content slides.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #05040C;\r\n  --surface:  rgba(255,255,255,0.05);\r\n  --pink:     #FF00C8;\r\n  --cyan:     #00F0FF;\r\n  --white:    #FFFFFF;\r\n  --text:     rgba(255,255,255,0.85);\r\n  --dim:      rgba(255,255,255,0.25);\r\n  --grid-line:rgba(255,0,200,0.06);\r\n  --display: 'Bebas Neue', sans-serif;\r\n  --body:    'Space Grotesk', system-ui, sans-serif;\r\n  --mono:    'Space Mono', monospace;\r\n}"
  },
  {
    "id": "swiss-international",
    "name": "Swiss International",
    "vibe": "Pure typographic authority. Inspired by Swiss International Typographic Style (Müller-Brockmann era) reimagined for digital. Strict grid, the slide number as a structural element, Swiss red (#E30613) as the only accent, Archivo Black. Everything earns its space through type.",
    "bestFor": "Consulting, strategy, executive audiences, frameworks, thought leadership that needs to feel authoritative and timeless. Print-sensibility in a digital format.",
    "avoidFor": "Lifestyle, hospitality, anything warm, anything dark, anything that needs \"energy\" or \"fun.\"",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:      #FFFFFF;\r\n  --surface: #F5F5F5;\r\n  --red:     #E30613;\r\n  --ink:     #000000;\r\n  --text:    #000000;\r\n  --muted:   #555555;\r\n  --dim:     #AAAAAA;\r\n  --border:  #000000;\r\n  --display: 'Archivo Black', sans-serif;\r\n  --sans:    'Archivo', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "tech-spec",
    "name": "Tech Spec",
    "vibe": "Engineering schematic meets SaaS data sheet. Looks lifted from a consumer electronics spec sheet or aerospace technical document — zoned layout, hairline grid, part codes, BOM rows. Instantly distinguished from any other LinkedIn carousel format.",
    "bestFor": "SaaS product launches, data-heavy B2B arguments, dev tools, technical explainers, product comparisons. Any content that wants to project precision and quantitative rigor.",
    "avoidFor": "Lifestyle, warm/personal content, anything that should feel human or emotional.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #F5F5F0;\r\n  --white:    #FFFFFF;\r\n  --grid:     rgba(0,0,0,0.04);\r\n  --grid-major: rgba(0,0,0,0.07);\r\n  --ink:      #111110;\r\n  --muted:    #555550;\r\n  --dim:      #999990;\r\n  --fade:     #BBBBAA;\r\n  --border:   #CCCCCC;\r\n  --orange:   #FF4500;  /* signal orange — the single accent */\r\n  --orange-bg:#FFF0EA;\r\n  --green:    #00996A;\r\n  --display: 'Space Grotesk', system-ui, sans-serif;\r\n  --mono:    'Space Mono', monospace;\r\n  --sans:    'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "frutiger-aero",
    "name": "Frutiger Aero",
    "vibe": "Luminous digital atmosphere — the 2006–2012 screensaver aesthetic reborn for 2026. Sky-blue-to-aqua gradient atmosphere, bokeh spheres, frosted pill capsules floating in air. Warm, optimistic, and impossible to mistake for anything else on LinkedIn.",
    "bestFor": "Consumer tech, healthtech, edtech, sustainability, coaching/wellness with a tech angle, startup B2C, any brand that wants to feel \"alive\" and human without going warm/terracotta.",
    "avoidFor": "Enterprise B2B, luxury, conservative industries, anything that needs to feel grounded or printed.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        linear-gradient(160deg, #C8EFFA 0%, #8FD8F0 22%, #5BBFE8 44%, #3BA8D8 62%, #58C8B8 80%, #7ADFC8 100%);\r\n  --teal:      #2A6A8A;\r\n  --deep-teal: #1E5A8A;\r\n  --sky:       #CCF6FF;\r\n  --text:      #FFFFFF;\r\n  --muted:     rgba(255,255,255,0.90);\r\n  --dim:       rgba(255,255,255,0.85);\r\n  --frost-bg:  rgba(255,255,255,0.42);\r\n  --frost-bdr: rgba(255,255,255,0.65);\r\n  --display: 'Nunito', system-ui, sans-serif;\r\n  --sans:    'DM Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "risograph-print",
    "name": "Risograph Print",
    "vibe": "Deliberate misregistration of a two-color risograph printing press. Blue ink pass + red ink pass never quite align — heading has a red ghost shadow, the blue block has a red offset shadow. Paper grain, halftone dots, printer's registration marks. Structured chaos on a rigid underlying grid.",
    "bestFor": "Creative agencies, independent consultants building a distinct voice, editorial newsletters, cultural brands, anyone who consciously rejects polished corporate aesthetics.",
    "avoidFor": "Enterprise, SaaS, finance, luxury, anything that must feel trustworthy and precise.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Arvo:ital,wght@0,400;0,700;1,400&family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;1,400&family=Barlow:wght@300;400;500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --paper:   #F5EDD6;  /* aged cream paper */\r\n  --blue:    #2D3B8E;  /* first ink pass — dominant */\r\n  --red:     #E8391D;  /* second ink pass — misregistered accent */\r\n  --text:    #2D3B8E;\r\n  --dim:     rgba(45,59,142,0.50);\r\n  --display: 'Arvo', serif;\r\n  --narrow:  'Barlow Condensed', sans-serif;\r\n  --sans:    'Barlow', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "neo-metallic-bronze",
    "name": "Neo-Metallic Bronze",
    "vibe": "Burnished cast metal — as if the slide was engraved into a bronze plate. The material IS the layout: a gradient engraving plate at the top (dark espresso → warm bronze → pale gold → back to dark) houses the heading; the body sits on dark patinated metal. Emboss/deboss effects simulate cast relief.",
    "bestFor": "Luxury B2B, premium pricing positioning, spirits/coffee/fragrance adjacent brands, financial services, senior executive personal branding, heritage or craft positioning.",
    "avoidFor": "Tech startups, SaaS, youth brands, anything fast-moving or casual.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cormorant+SC:wght@400;600&family=Libre+Franklin:wght@300;400;500;600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:          #0E0804;\r\n  --plate:       linear-gradient(135deg, #2A1A0C 0%, #4A3020 15%, #8B5E3C 30%, #C9956A 45%, #F0D9A0 55%, #C9956A 65%, #8B5E3C 78%, #3B2A1A 92%, #1A0E08 100%);\r\n  --relief:      linear-gradient(145deg, #2A1A0C 0%, #3B2A1A 20%, #4A3520 45%, #3B2A1A 80%, #1A0E08 100%);\r\n  --gold:        #F0D9A0;\r\n  --copper:      #C9956A;\r\n  --bronze:      #8B5E3C;\r\n  --espresso:    #1A0E08;\r\n  --text:        rgba(200,149,106,0.80);\r\n  --text-bright: rgba(240,217,160,0.95);\r\n  --dim:         rgba(200,149,106,0.40);\r\n  --serif:  'Cormorant Garamond', Georgia, serif;\r\n  --sc:     'Cormorant SC', serif;\r\n  --sans:   'Libre Franklin', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "cinematic-serif",
    "name": "Cinematic Serif",
    "vibe": "Movie title card. One word at impossible scale, letterboxed black bars top and bottom, film grain, amber warm light. The layout logic is entirely cinematic: extreme typographic hierarchy (200px vs. 11px), intentional off-balance composition, ultra-wide tracking on secondary text. Feels like a still from a prestige film.",
    "bestFor": "Executive thought leadership, founder personal branding, deep-narrative content (case studies, transformation stories), strategy consulting. Any content from a senior voice that benefits from drama and authority.",
    "avoidFor": "Listicles, tactical how-to content, SaaS product marketing, anything data-heavy or cheerful.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Josefin+Sans:ital,wght@0,300;0,400;0,600;0,700;1,300&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:         #0A0805;\r\n  --letterbox:  #000000;\r\n  --paper:      #F5E8C0;  /* aged film positive */\r\n  --amber:      #C8922A;\r\n  --amber-glow: rgba(200,146,42,0.70);\r\n  --text:       rgba(245,232,192,0.65);\r\n  --text-bright:rgba(245,232,192,0.95);\r\n  --display: 'Playfair Display', Georgia, serif;\r\n  --label:   'Josefin Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "liquid-glass",
    "name": "Liquid Glass",
    "vibe": "Apple's iOS 26 / visionOS design language applied to LinkedIn. Vivid colour blobs form the raw background; every UI element is a pure glass panel that reveals and refracts those colours through it. The background IS the content — the glass is the interface. Cutting-edge premium tech aesthetic, immediately recognisable as the 2025–2026 era.",
    "bestFor": "AI/ML products, premium tech thought leadership, product launches, consumer tech, fintech, health tech, any brand that wants to signal \"we live at the frontier.\"",
    "avoidFor": "Conservative B2B, luxury heritage, warm/human content, risograph/brutalist audiences, anything that needs to feel grounded or printed.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,300;1,14..32,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg-dark:    #0A0A14;\r\n  /* Apple system colors — used in background blobs only */\r\n  --apple-purple: #5E5CE6;\r\n  --apple-green:  #30D158;\r\n  --apple-red:    #FF375F;\r\n  --apple-blue:   #0A84FF;\r\n  --apple-orange: #FF9F0A;\r\n  /* Glass panel properties */\r\n  --glass-bg:   rgba(255,255,255,0.10);\r\n  --glass-rim:  rgba(255,255,255,0.28);\r\n  --glass-spec: rgba(255,255,255,0.30);  /* specular rim highlight */\r\n  --glass-blur: blur(60px) saturate(2.0) brightness(1.10);\r\n  /* Text */\r\n  --text:       #FFFFFF;\r\n  --text-dim:   rgba(255,255,255,0.55);\r\n  --text-ghost: rgba(255,255,255,0.30);\r\n  --sans: 'Inter', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "bauhaus-geometric",
    "name": "Bauhaus Geometric",
    "vibe": "Pure Bauhaus — form follows function, but the forms are bold primary-coloured CSS shapes. A large circle, a rectangle, a horizontal bar, thin grid lines: these ARE the layout. Every geometric element serves both decoration and structural purpose simultaneously. Inspired by Herbert Bayer, Moholy-Nagy, and the Bauhaus poster tradition.",
    "bestFor": "Bold thought leadership, design-adjacent audiences, marketing/creative industry, bold contrarian takes. Any carousel that should feel visually assertive and confident without going dark/edgy.",
    "avoidFor": "Luxury, warm human content, clinical/medical, anything that must feel approachable or modern-minimal.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,300;0,400;0,500;0,700;0,900;1,300&family=Space+Mono:wght@400;700&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:      #F2EEDF;  /* warm Bauhaus cream */\r\n  --ink:     #1A1A1A;\r\n  --red:     #E63329;  /* Bauhaus primary red */\r\n  --blue:    #1B4F9C;  /* Bauhaus primary blue */\r\n  --yellow:  #F5C842;  /* Bauhaus primary yellow */\r\n  --display: 'Jost', system-ui, sans-serif;\r\n  --mono:    'Space Mono', monospace;\r\n}"
  },
  {
    "id": "blueprint",
    "name": "Blueprint",
    "vibe": "Architectural technical drawing — dark navy base, white/cyan hairline grid, blueprint corner brackets framing content areas, SVG dimension lines and callout annotations, crosshairs, arc circles. Every content section is a \"drawing zone\" with an ID tag. Looks like it was lifted from an engineering drawing tool.",
    "bestFor": "B2B technical content, SaaS product architecture, data-heavy analysis, process documentation, any content that should feel rigorous, precise, and system-level.",
    "avoidFor": "Lifestyle, warm content, luxury, anything that should feel human/approachable/casual.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Share+Tech&family=Oswald:wght@300;400;500;600;700&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:      #032B55;  /* classic blueprint blue */\r\n  --cyan:    #64C8FF;  /* blueprint line color */\r\n  --white:   #FFFFFF;\r\n  --grid:    rgba(100,200,255,0.08);\r\n  --grid-major: rgba(100,200,255,0.14);\r\n  --text:    #FFFFFF;\r\n  --muted:   rgba(255,255,255,0.55);\r\n  --dim:     rgba(100,200,255,0.40);\r\n  --border:  rgba(100,200,255,0.30);\r\n  --display: 'Oswald', system-ui, sans-serif;\r\n  --mono:    'Share Tech Mono', monospace;\r\n  --sans:    'Share Tech', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "retro-poster",
    "name": "Retro Poster",
    "vibe": "1950s WPA poster / vintage commercial art. A large diagonal `clip-path` colour plane cuts across the canvas — content lives in two distinct zones: warm cream above the diagonal, and deep teal below. Bold condensed type, halftone dot screen, screen-print grain, limited flat palette. Zero gradients, zero rounded corners on structure.",
    "bestFor": "Bold takes, industry-disruption narratives, marketing/creative content, branded thought leadership. Works wherever Neo-Brutalism feels too aggressive — same energy, more warmth.",
    "avoidFor": "SaaS, tech, luxury heritage, anything needing nuance or polish.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;0,900;1,700&family=DM+Serif+Display:ital@0;1&family=Barlow:wght@300;400;500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --cream:   #F0E8D0;\r\n  --teal:    #1B4A4A;\r\n  --red:     #C4341A;\r\n  --ink:     #1A1A1A;\r\n  --text-on-teal: #F0E8D0;\r\n  --display: 'Barlow Condensed', system-ui, sans-serif;\r\n  --serif:   'DM Serif Display', Georgia, serif;\r\n  --sans:    'Barlow', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "paper-cutout",
    "name": "Paper Cutout",
    "vibe": "Layered physical paper collage. The canvas reads as a craft-paper table with coloured torn-paper sheets scattered beneath a primary white card. Everything has material depth — irregular-edge colour papers in the background, white content card with a multi-layer shadow, a note card inside. Like a mood board built from physical materials.",
    "bestFor": "Coaching, wellness, creative brands, culture/people content, HR/L&D, any content that needs warmth, texture, and a handmade quality without going rustic.",
    "avoidFor": "Technical/data content, luxury, anything needing precision or digital-native aesthetics.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,600&family=Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --kraft:     #E8E0CC;  /* craft paper base */\r\n  --white:     #FFFFFF;\r\n  --terra:     #D4604A;  /* terracotta paper */\r\n  --sage:      #6A9E78;  /* sage paper */\r\n  --yellow:    #F2D060;  /* yellow paper */\r\n  --sage-light:#EBF3EC;  /* very light sage for note card */\r\n  --text:      #2A2420;\r\n  --muted:     #7A7068;\r\n  --border:    #EDE8DF;\r\n  --serif:  'Fraunces', Georgia, serif;\r\n  --sans:   'Nunito', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "x-thread",
    "name": "X Thread",
    "vibe": "Content presented as a viral Twitter/X thread. The slide looks like a screenshot of an active X conversation — avatar, display name, @handle, verified checkmark, tweet text, thread connector line, engagement metrics (replies, retweets, likes, views), quote-tweet embeds. Pure X dark mode: #000000 background, #2F3336 borders, #1D9BF0 blue, #F91880 hearts.",
    "bestFor": "Thought leadership from a personal brand voice, hot takes and contrarian viewpoints, content that performs on X and is being repurposed, B2B founders building audience, any carousel designed to feel like a real conversation happening on the internet.",
    "avoidFor": "Company/brand accounts without a personal voice, luxury, clinical data reports, anything that needs to feel formal, printed, or institutional.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:           #000000;  /* X pure black */\r\n  --border:       #2F3336;  /* X border/divider */\r\n  --text:         #FFFFFF;\r\n  --muted:        #71767B;  /* X secondary text */\r\n  --blue:         #1D9BF0;  /* X accent blue */\r\n  --heart:        #F91880;  /* X like/heart pink */\r\n  --thread-line:  #2F3336;\r\n  --sans: 'Inter', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "youtube",
    "name": "YouTube",
    "vibe": "YouTube video page in dark mode — the content IS the thumbnail. Authentic platform UI that signals video-native thinking and high engagement. Educational authority through the lens of a creator economy format.",
    "bestFor": "Content marketing, GTM education, thought leadership positioned as \"video essay\" content, audiences who respond to YouTube/creator aesthetics. Strong for B2B SaaS with high-ticket educational content.",
    "avoidFor": "Luxury/premium positioning, formal executive audiences, anything that needs to feel print-polished.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:          #0F0F0F;  /* YouTube dark — NOT pure black */\r\n  --surface:     #272727;  /* Card/chip bg */\r\n  --surface-2:   #1A1A1A;  /* Thumbnail bg */\r\n  --red:         #FF0000;  /* YouTube red */\r\n  --red-lt:      #FF6B6B;  /* Text accent */\r\n  --blue:        #3EA6FF;  /* liked state / link */\r\n  --text:        #FFFFFF;\r\n  --muted:       #AAAAAA;  /* Secondary text */\r\n  --border:      #272727;  /* Divider */\r\n  --sans:        'Roboto', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "spotify",
    "name": "Spotify",
    "vibe": "Spotify playlist page in dark mode — content is structured as a \"playlist\" or \"podcast\" with a track list. Data-driven, list-friendly, musical metaphor for sequenced insights. The green accent (#1DB954) is instantly recognisable.",
    "bestFor": "Listicles, frameworks, sequential \"steps\" content, anything with 5–8 discrete items, audiences who respond to playlist/content curation aesthetics. Strong for content marketing, B2B SaaS, and creator-economy positioning.",
    "avoidFor": "Single-idea narratives, luxury positioning, formal executive audiences. Never use for content that doesn't have a list-like structure.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:          #121212;  /* Spotify's exact dark bg */\r\n  --surface:     #181818;  /* Playback bar bg */\r\n  --surface-2:   #282828;  /* Track row hover / divider */\r\n  --green:       #1DB954;  /* Spotify green — THE accent */\r\n  --green-dim:   rgba(29,185,84,0.12);  /* Green chip bg */\r\n  --text:        #FFFFFF;\r\n  --muted:       #B3B3B3;  /* Secondary text */\r\n  --border:      #282828;\r\n  --sans-head:   'Montserrat', system-ui, sans-serif;\r\n  --sans-body:   'Inter', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "notion-document",
    "name": "Notion Document",
    "vibe": "Knowledge-base / PKM tool aesthetic — clean, structured, properties-driven. Feels like you're looking at a published Notion page. Signals \"systems thinker\" personal brand and appeals strongly to operators, founders, and knowledge workers.",
    "bestFor": "Frameworks, processes, how-to guides, structured thought leadership, \"second brain\" adjacent content. Strong for productivity, operations, SaaS, and startup audiences.",
    "avoidFor": "Emotional/story-driven content, luxury positioning, B2C. Never use for content that doesn't have a natural property/attribute structure.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:        #FFFFFF;\r\n  --surface:   #F7F7F5;  /* Notion sidebar bg */\r\n  --border:    #E8E8E6;\r\n  --text:      #37352F;  /* Notion's exact text color */\r\n  --muted:     #9B9A97;\r\n  --blue:      #2D6CE6;  /* Notion accent */\r\n  --co-yellow: #FBF3DB;  /* callout yellow bg */\r\n  --co-blue:   #EEF2FC;  /* callout blue bg */\r\n  --co-green:  #EDF3EB;  /* callout green bg */\r\n  --co-red:    #FDECEA;  /* callout red bg */\r\n  --sans: 'Inter', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "newspaper-broadsheet",
    "name": "Newspaper Broadsheet",
    "vibe": "Editorial print journalism — authoritative, considered, deeply credible. Feels like a front page of The Economist, FT, or NYT. Newsprint texture, Playfair Display masthead, multi-column body text with column rules. Commands respect through format alone.",
    "bestFor": "Authoritative thought leadership, industry analysis, controversial takes that need credibility, long-form insights compressed into a slide. Strong for B2B executives, consulting, and finance-adjacent audiences.",
    "avoidFor": "Consumer/lifestyle content, anything playful or casual, anything that needs to feel modern/digital-native.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,600;1,700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:      #FAF6E8;  /* newsprint warm cream */\r\n  --ink:     #1A1A1A;\r\n  --rule:    #1A1A1A;\r\n  --muted:   #555555;\r\n  --gray:    #888888;\r\n  --lt-rule: #BBBBBB;\r\n  --serif-display: 'Playfair Display', Georgia, serif;\r\n  --serif-body:    'EB Garamond', Georgia, serif;\r\n}"
  },
  {
    "id": "reddit-thread",
    "name": "Reddit Thread",
    "vibe": "Reddit dark mode forum — community discussion, social proof through upvotes, authentic engagement. The vote score column on the left is immediately recognisable. Strong for \"here's what the community says about X\" framing.",
    "bestFor": "Contrarian takes, community-sourced insights, \"hot take\" content, B2B content that benefits from social proof framing. Strong when the content can be framed as a widely-upvoted discussion rather than a lecture.",
    "avoidFor": "Luxury, formal executive audiences, anything that should feel polished or corporate. Never use for content that doesn't have a natural \"discussion\" quality.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:         #1A1A1B;  /* Reddit dark bg */\r\n  --surface:    #272729;  /* Post card bg */\r\n  --surface-2:  #1F1F20;  /* Vote column bg */\r\n  --border:     #343536;\r\n  --text:        #D7DADC;\r\n  --muted:       #818384;  /* Reddit secondary text */\r\n  --orange:      #FF4500;  /* Reddit orange — upvote, logo, stats */\r\n  --teal:        #0DD3BB;  /* OP badge */\r\n  --sans: 'IBM Plex Sans', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "kanban-board",
    "name": "Kanban Board",
    "vibe": "Linear / Jira / Trello project board — structured, operational, systems-oriented. Horizontal status columns signal \"this is a process with stages.\" Great for content that is naturally sequential or stage-based.",
    "bestFor": "Process content, implementation guides, \"here's how we did it\" content, project management topics, SaaS operations content. Strong for startup/scale-up audiences and anyone building GTM processes.",
    "avoidFor": "Narrative/story content, luxury audiences, emotional or personal brand content. The grid feels cold for warm human topics.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #F1F2F4;  /* Jira board bg */\r\n  --col-bg:   #EBECF0;  /* Column bg */\r\n  --card-bg:  #FFFFFF;\r\n  --border:   #DFE1E6;\r\n  --text:     #172B4D;  /* Jira dark blue */\r\n  --muted:    #42526E;\r\n  --dim:      #6B778C;\r\n  --blue:     #0052CC;  /* Jira blue */\r\n  --green:    #36B37E;  /* Done/success */\r\n  --red:      #FF5630;  /* Blocked/high priority */\r\n  --sans: 'Inter', system-ui, sans-serif;\r\n}"
  },
  {
    "id": "analytics-dashboard",
    "name": "Analytics Dashboard",
    "vibe": "Google Analytics / Mixpanel data dashboard — metrics-first, evidence-driven, professional. The \"Live\" badge signals real-time data. CSS horizontal bar chart makes conversion data visually scannable. Perfect for content that is centered on benchmarks, statistics, and performance data.",
    "bestFor": "Data-heavy content, benchmark reveals, \"the data shows X\" narratives, performance marketing content, SaaS metrics, conversion rate content. Strong for B2B audiences that respond to evidence over assertion.",
    "avoidFor": "Narrative/story content, personal brand, emotional topics, anything without clear metrics. Never use for content that can't be expressed as numbers.",
    "fontsLink": "<link href=\"https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap\" rel=\"stylesheet\">",
    "cssTokens": ":root {\r\n  --bg:       #F0F4FA;  /* dashboard bg */\r\n  --surface:  #FFFFFF;  /* card/panel bg */\r\n  --border:   #E2E8F0;\r\n  --text:     #0F172A;  /* near-black */\r\n  --muted:    #64748B;\r\n  --dim:      #94A3B8;\r\n  --blue:     #2563EB;  /* primary metric */\r\n  --green:    #16A34A;  /* positive trend */\r\n  --red:      #DC2626;  /* negative trend */\r\n  --violet:   #7C3AED;  /* secondary metric */\r\n  --sans: 'Inter', system-ui, sans-serif;\r\n}"
  }
]

/** Case-insensitive lookup by id or name. Null rather than a throw: the caller reports the near misses. */
export function findPreset(name: string): StudioPreset | null {
  const needle = String(name ?? '').trim().toLowerCase()
  if (!needle) return null
  return STUDIO_PRESETS.find(p => p.id === needle || p.name.toLowerCase() === needle) ?? null
}
