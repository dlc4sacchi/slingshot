#!/usr/bin/env python3
"""
Slingshot Chrome Web Store Marketing Screenshot Generator
Generates 3 high-quality 1280x800 PNG screenshots.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Output paths ──
OUT_DIR = os.path.expanduser("~")
W, H = 1280, 800

# ── Slingshot design tokens (from codebase) ──
DARK = {
    "bg": "#08070f",
    "bg2": "#0e0d1a",
    "bg3": "#131224",
    "bg4": "#1a1830",
    "border": "rgba(108,99,255,0.11)",
    "border2": "rgba(108,99,255,0.24)",
    "purple": "#8b84ff",
    "purple2": "#b0abff",
    "purple_dim": "rgba(139,132,255,0.15)",
    "teal": "#34d399",
    "text": "#f0eeff",
    "text2": "rgba(240,238,255,0.52)",
    "text3": "rgba(240,238,255,0.26)",
    "grad_purple": "#6c63ff",
    "grad_teal": "#34d399",
}


def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join([c*2 for c in h])
    if len(h) != 6:
        # Return a default gray for invalid hex
        return (128, 128, 128)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def parse_rgba(s):
    if s.startswith('rgba('):
        inner = s[s.find('(')+1:s.find(')')]
        parts = inner.split(',')
        return (int(parts[0]), int(parts[1]), int(parts[2]), int(float(parts[3])*255))
    if s.startswith('rgb('):
        inner = s[s.find('(')+1:s.find(')')]
        parts = inner.split(',')
        return (int(parts[0]), int(parts[1]), int(parts[2]), 255)
    return hex_to_rgb(s) + (255,)


def get_color(key, alpha=1.0):
    c = parse_rgba(DARK[key])
    if alpha < 1.0:
        return (c[0], c[1], c[2], int(c[3] * alpha))
    return c


# ── Font helpers ──
def load_font(size, bold=False, mono=False):
    """Try to load a nice font, fall back to defaults."""
    candidates = []
    if mono:
        candidates = ['DejaVuSansMono.ttf', 'LiberationMono-Regular.ttf', 'Courier New.ttf', 'cour.ttf']
    elif bold:
        candidates = ['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'Arial Bold.ttf', 'arialbd.ttf']
    else:
        candidates = ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'Arial.ttf', 'arial.ttf']
    
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            pass
    return ImageFont.load_default()


# ── Drawing primitives ──
def round_rect(draw, xy, radius, fill, outline=None, width=1):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_text_shadow(draw, pos, text, font, fill, shadow_color, offset=(1, 1), blur=0):
    """Draw text with a subtle shadow."""
    x, y = pos
    sx, sy = offset
    # Shadow
    draw.text((x + sx, y + sy), text, font=font, fill=shadow_color)
    # Main text
    draw.text((x, y), text, font=font, fill=fill)


def glow_rect(img, xy, radius, color, blur_radius=20, alpha=0.3):
    """Add a glow effect behind a rectangle area."""
    x1, y1, x2, y2 = xy
    # Create a temporary image for the glow
    temp = Image.new('RGBA', img.size, (0, 0, 0, 0))
    temp_draw = ImageDraw.Draw(temp)
    temp_draw.rounded_rectangle(xy, radius=radius, fill=color)
    temp = temp.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    # Composite
    img_rgba = img.convert('RGBA')
    img_rgba = Image.alpha_composite(img_rgba, temp)
    return img_rgba


def gradient_bg(width, height, color_top, color_bottom):
    """Create a vertical gradient background."""
    img = Image.new('RGB', (width, height), color_top)
    draw = ImageDraw.Draw(img)
    r1, g1, b1 = hex_to_rgb(color_top)
    r2, g2, b2 = hex_to_rgb(color_bottom)
    for y in range(height):
        ratio = y / height
        r = int(r1 + (r2 - r1) * ratio)
        g = int(g1 + (g2 - g1) * ratio)
        b = int(b1 + (b2 - b1) * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))
    return img


def radial_glow_overlay(width, height, center, max_radius, color, alpha=0.15):
    """Add a radial glow overlay."""
    overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = center
    steps = 60
    for i in range(steps, 0, -1):
        ratio = i / steps
        radius = max_radius * ratio
        a = int(alpha * 255 * (1 - ratio))
        c = (color[0], color[1], color[2], a)
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=c)
    return overlay


# ── UI Component helpers ──
def draw_browser_chrome(draw, img, x, y, w, h, title="Slingshot"):
    """Draw a realistic dark browser window chrome."""
    # Window background
    round_rect(draw, (x, y, x + w, y + h), 12, fill=get_color("bg2"), outline=get_color("border2"), width=1)
    
    # Title bar
    title_h = 36
    round_rect(draw, (x, y, x + w, y + title_h), 12, fill=get_color("bg3"))
    # Flatten bottom corners of title bar
    draw.rectangle((x, y + title_h - 12, x + w, y + title_h), fill=get_color("bg3"))
    
    # Traffic lights
    light_colors = [("#ff5f57", 0), ("#febc2e", 1), ("#28c840", 2)]
    for color, idx in light_colors:
        lx = x + 14 + idx * 16
        ly = y + 12
        draw.ellipse([lx, ly, lx + 10, ly + 10], fill=hex_to_rgb(color))
    
    # Tab
    tab_w = 160
    tab_x = x + 70
    tab_y = y + 6
    round_rect(draw, (tab_x, tab_y, tab_x + tab_w, tab_y + 26), 8, fill=get_color("bg2"))
    # Tab favicon placeholder
    draw.rectangle([tab_x + 10, tab_y + 7, tab_x + 18, tab_y + 15], fill=get_color("purple"))
    # Tab text
    font_tab = load_font(10)
    draw.text((tab_x + 24, tab_y + 6), title, font=font_tab, fill=get_color("text2"))
    
    # Address bar
    bar_y = y + title_h + 8
    bar_h = 32
    bar_margin = 12
    round_rect(draw, (x + bar_margin, bar_y, x + w - bar_margin, bar_y + bar_h), 8, 
               fill=get_color("bg"), outline=get_color("border"), width=1)
    
    # Lock icon
    lock_x = x + bar_margin + 10
    lock_y = bar_y + 9
    draw.rectangle([lock_x, lock_y + 4, lock_x + 8, lock_y + 12], fill=get_color("text3"))
    draw.arc([lock_x - 2, lock_y - 2, lock_x + 10, lock_y + 8], 0, 180, fill=get_color("text3"), width=2)
    
    return bar_y, bar_h, bar_margin


def draw_omnibox_query(draw, x, y, w, h, query, bang, font_mono, font_text):
    """Draw an address bar with query and highlighted bang."""
    # Query text
    q_x = x + 28
    q_y = y + 7
    
    # Draw query part
    draw.text((q_x, q_y), query + " ", font=font_text, fill=get_color("text"))
    bbox = draw.textbbox((q_x, q_y), query + " ", font=font_text)
    bang_x = bbox[2]
    
    # Draw highlighted bang
    bang_w = draw.textbbox((0, 0), bang, font=font_mono)[2]
    # Bang background pill
    round_rect(draw, (bang_x - 2, q_y - 2, bang_x + bang_w + 6, q_y + 18), 4, 
               fill=(52, 211, 153, 40), outline=(52, 211, 153, 80), width=1)
    draw.text((bang_x + 2, q_y), bang, font=font_mono, fill=get_color("teal"))
    
    # Cursor
    cursor_x = bang_x + bang_w + 8
    draw.rectangle([cursor_x, q_y, cursor_x + 2, q_y + 16], fill=get_color("purple"))


def draw_popup_card(img, draw, x, y, w, h):
    """Draw the Slingshot popup card."""
    # Card shadow/glow
    img_rgba = img.convert('RGBA')
    shadow = Image.new('RGBA', img_rgba.size, (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_draw.rounded_rectangle((x, y, x + w, y + h), radius=14, fill=(14, 13, 26, 255))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
    img_rgba = Image.alpha_composite(img_rgba, shadow)
    img.paste(img_rgba)
    
    # Card body
    round_rect(draw, (x, y, x + w, y + h), 14, fill=get_color("bg2"), 
               outline=get_color("border"), width=1)
    
    return img


def draw_logo(draw, x, y, size=20):
    """Draw the Slingshot logo mark + wordmark."""
    # Icon
    icon_size = size
    round_rect(draw, (x, y, x + icon_size, y + icon_size), 6, 
               fill=get_color("purple"))
    # S letter
    font_s = load_font(int(size * 0.55), bold=True)
    draw.text((x + 4, y + 1), "S", font=font_s, fill=(255, 255, 255))
    
    # Wordmark
    wx = x + icon_size + 6
    font_word = load_font(int(size * 0.65), bold=True)
    draw.text((wx, y + 2), "Sling", font=font_word, fill=get_color("text"))
    bbox = draw.textbbox((wx, y + 2), "Sling", font=font_word)
    draw.text((bbox[2], y + 2), "shot", font=font_word, fill=get_color("text3"))
    # Dot
    dot_x = bbox[2] + draw.textbbox((0, 0), "shot", font=font_word)[2] - 28
    draw.ellipse([dot_x + 2, y + size - 4, dot_x + 6, y + size], fill=get_color("purple"))


def draw_engine_row(draw, x, y, w, icon_color, name, bang, font_name, font_bang, font_bang_big=None):
    """Draw a single engine row in the popup."""
    row_h = 28
    # Icon
    round_rect(draw, (x, y + 4, x + 16, y + 20), 4, fill=icon_color)
    # Name
    draw.text((x + 22, y + 4), name, font=font_name, fill=get_color("text"))
    # Bang
    if font_bang_big:
        bang_w = draw.textbbox((0, 0), bang, font=font_bang_big)[2]
        draw.text((x + w - bang_w - 4, y + 3), bang, font=font_bang_big, fill=get_color("purple"))
    else:
        bang_w = draw.textbbox((0, 0), bang, font=font_bang)[2]
        draw.text((x + w - bang_w - 4, y + 5), bang, font=font_bang, fill=get_color("purple"))
    return row_h


def draw_toggle(draw, x, y, on=True):
    """Draw a toggle switch."""
    tw, th = 38, 22
    round_rect(draw, (x, y, x + tw, y + th), 11, fill=get_color("purple") if on else get_color("bg4"))
    knob_x = x + 18 if on else x + 2
    draw.ellipse([knob_x, y + 2, knob_x + 16, y + 18], fill=(255, 255, 255))


# ── Screenshot 1: Hero ──
def make_screenshot_1():
    """Hero screenshot: Address bar + popup + headline."""
    # Background with subtle gradient
    img = gradient_bg(W, H, DARK["bg"], "#0c0b18")
    draw = ImageDraw.Draw(img)
    
    # Radial glows
    glow1 = radial_glow_overlay(W, H, (W//2, H//2 - 50), 500, hex_to_rgb(DARK["grad_purple"]), 0.08)
    img = Image.alpha_composite(img.convert('RGBA'), glow1).convert('RGB')
    draw = ImageDraw.Draw(img)
    
    # Browser window
    bw, bh = 900, 420
    bx = (W - bw) // 2
    by = 180
    
    bar_y, bar_h, bar_m = draw_browser_chrome(draw, img, bx, by, bw, bh, "New Tab")
    
    # Address bar content
    font_mono = load_font(13, mono=True)
    font_text = load_font(13)
    bar_x = bx + bar_m
    bar_w = bw - bar_m * 2
    draw_omnibox_query(draw, bar_x, bar_y, bar_w, bar_h, 
                       "how to build a chrome extension", "!gemini", font_mono, font_text)
    
    # Popup floating
    pw, ph = 280, 320
    px = bx + bw - pw - 20
    py = by + bar_y + bar_h + 10
    
    img = draw_popup_card(img, draw, px, py, pw, ph)
    draw = ImageDraw.Draw(img)
    
    # Popup header
    draw_logo(draw, px + 12, py + 12, size=18)
    
    # Section: AI
    sec_font = load_font(9, mono=True)
    draw.text((px + 12, py + 44), "AI", font=sec_font, fill=get_color("text3"))
    
    # AI engines
    ai_engines = [
        ("#10a37f", "ChatGPT", "!c"),
        ("#cc785c", "Claude", "!cl"),
        ("#4285f4", "Gemini", "!g"),
        ("#4a4ff7", "DeepSeek", "!d"),
        ("#20b2aa", "Perplexity", "!p"),
        ("#7c3aed", "Mistral", "!mi"),
        ("#ffbd2e", "HuggingChat", "!hf"),
    ]
    ey = py + 60
    font_name = load_font(11)
    font_bang = load_font(10, mono=True)
    for color, name, bang in ai_engines:
        draw_engine_row(draw, px + 12, ey, pw - 24, hex_to_rgb(color), name, bang, font_name, font_bang)
        ey += 26
    
    # Divider
    draw.line([(px + 12, ey), (px + pw - 12, ey)], fill=get_color("border"), width=1)
    ey += 8
    
    # Section: Search
    draw.text((px + 12, ey), "SEARCH", font=sec_font, fill=get_color("text3"))
    ey += 16
    
    search_engines = [
        ("#4285f4", "Google", "!gg"),
        ("#ff0000", "YouTube", "!yt"),
        ("#ff4500", "Reddit", "!r"),
        ("#333", "Wikipedia", "!w"),
    ]
    for color, name, bang in search_engines:
        draw_engine_row(draw, px + 12, ey, pw - 24, hex_to_rgb(color), name, bang, font_name, font_bang)
        ey += 26
    
    # Footer hint
    font_hint = load_font(9, mono=True)
    draw.text((px + 12, py + ph - 22), "Alt+Shift+B", font=font_hint, fill=get_color("text3"))
    draw.text((px + 80, py + ph - 22), "opens slingshot", font=font_hint, fill=get_color("text3"))
    
    # ── Headline & Subtitle (outside browser, top area) ──
    font_headline = load_font(48, bold=True)
    font_sub = load_font(20)
    
    headline = "Search any AI from your address bar"
    subtitle = "Type your query, add a shortcut, and launch instantly."
    
    # Measure and center
    hbbox = draw.textbbox((0, 0), headline, font=font_headline)
    sbbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    hw = hbbox[2] - hbbox[0]
    sw = sbbox[2] - sbbox[0]
    
    hx = (W - hw) // 2
    sx = (W - sw) // 2
    hy = 60
    sy = hy + 58
    
    # Subtle glow behind headline
    glow_h = radial_glow_overlay(W, H, (W//2, hy + 20), 300, hex_to_rgb(DARK["grad_purple"]), 0.12)
    img = Image.alpha_composite(img.convert('RGBA'), glow_h).convert('RGB')
    draw = ImageDraw.Draw(img)
    
    draw.text((hx, hy), headline, font=font_headline, fill=get_color("text"))
    draw.text((sx, sy), subtitle, font=font_sub, fill=get_color("text2"))
    
    # Small feature pills below browser
    pills = ["!c  ChatGPT", "!g  Gemini", "!yt  YouTube", "!cl  Claude", "!p  Perplexity"]
    pill_font = load_font(12, mono=True)
    px_start = (W - (len(pills) * 110)) // 2
    p_y = by + bh + 30
    for i, pill in enumerate(pills):
        p_x = px_start + i * 110
        pw_text = draw.textbbox((0, 0), pill, font=pill_font)[2]
        round_rect(draw, (p_x, p_y, p_x + pw_text + 16, p_y + 28), 14, 
                   fill=get_color("bg3"), outline=get_color("border2"), width=1)
        draw.text((p_x + 8, p_y + 5), pill, font=pill_font, fill=get_color("text2"))
    
    return img


# ── Screenshot 2: Popup Focus ──
def make_screenshot_2():
    """Popup-focused screenshot showing all engines cleanly."""
    img = gradient_bg(W, H, DARK["bg"], "#0c0b18")
    draw = ImageDraw.Draw(img)
    
    # Background glow
    glow = radial_glow_overlay(W, H, (W//2, H//2), 550, hex_to_rgb(DARK["grad_purple"]), 0.06)
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    draw = ImageDraw.Draw(img)
    
    # Headline at top
    font_headline = load_font(40, bold=True)
    font_sub = load_font(18)
    headline = "All your AI tools, one shortcut away"
    subtitle = "Type !ai to fire every active engine at once."
    
    hbbox = draw.textbbox((0, 0), headline, font=font_headline)
    sbbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    hx = (W - (hbbox[2]-hbbox[0])) // 2
    sx = (W - (sbbox[2]-sbbox[0])) // 2
    draw.text((hx, 50), headline, font=font_headline, fill=get_color("text"))
    draw.text((sx, 108), subtitle, font=font_sub, fill=get_color("text2"))
    
    # Main popup card (large, centered)
    pw, ph = 520, 540
    px = (W - pw) // 2
    py = 160
    
    # Glow behind popup
    img_rgba = img.convert('RGBA')
    shadow = Image.new('RGBA', img_rgba.size, (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_draw.rounded_rectangle((px-8, py-8, px+pw+8, py+ph+8), radius=20, 
                              fill=(108, 99, 255, 30))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=20))
    img_rgba = Image.alpha_composite(img_rgba, shadow)
    img.paste(img_rgba)
    draw = ImageDraw.Draw(img)
    
    round_rect(draw, (px, py, px + pw, py + ph), 16, fill=get_color("bg2"), 
               outline=get_color("border2"), width=1)
    
    # Popup header
    draw_logo(draw, px + 20, py + 16, size=22)
    
    # Section: AI
    sec_y = py + 56
    sec_font = load_font(10, mono=True)
    draw.text((px + 20, sec_y), "AI", font=sec_font, fill=get_color("text3"))
    
    # AI grid - 2 columns
    ai_engines = [
        ("#10a37f", "ChatGPT", "!c"),
        ("#cc785c", "Claude", "!cl"),
        ("#4285f4", "Gemini", "!g"),
        ("#4a4ff7", "DeepSeek", "!d"),
        ("#20b2aa", "Perplexity", "!p"),
        ("#7c3aed", "Mistral", "!mi"),
        ("#ffbd2e", "HuggingChat", "!hf"),
    ]
    
    col_w = (pw - 56) // 2
    ey = sec_y + 22
    font_name = load_font(13)
    font_bang = load_font(12, mono=True)
    
    for i, (color, name, bang) in enumerate(ai_engines):
        col = i % 2
        row = i // 2
        ex = px + 20 + col * (col_w + 16)
        ey_item = ey + row * 34
        # Item bg
        round_rect(draw, (ex, ey_item, ex + col_w, ey_item + 30), 6, fill=get_color("bg3"))
        # Icon
        round_rect(draw, (ex + 6, ey_item + 6, ex + 20, ey_item + 20), 4, fill=hex_to_rgb(color))
        # Name
        draw.text((ex + 26, ey_item + 5), name, font=font_name, fill=get_color("text"))
        # Bang
        bw = draw.textbbox((0, 0), bang, font=font_bang)[2]
        draw.text((ex + col_w - bw - 8, ey_item + 6), bang, font=font_bang, fill=get_color("purple"))
    
    ey = ey + ((len(ai_engines) + 1) // 2) * 34 + 10
    
    # Divider
    draw.line([(px + 20, ey), (px + pw - 20, ey)], fill=get_color("border"), width=1)
    ey += 14
    
    # Section: Search
    draw.text((px + 20, ey), "SEARCH", font=sec_font, fill=get_color("text3"))
    ey += 22
    
    search_engines = [
        ("#4285f4", "Google", "!gg"),
        ("#ff0000", "YouTube", "!yt"),
        ("#ff4500", "Reddit", "!r"),
        ("#333", "Wikipedia", "!w"),
        ("#fb522c", "Brave Search", "!bs"),
        ("#0acf83", "Figma Community", "!fg"),
        ("#ff6600", "Hacker News", "!hn"),
        ("#07a081", "Pexels", "!px"),
    ]
    
    for i, (color, name, bang) in enumerate(search_engines):
        col = i % 2
        row = i // 2
        ex = px + 20 + col * (col_w + 16)
        ey_item = ey + row * 34
        round_rect(draw, (ex, ey_item, ex + col_w, ey_item + 30), 6, fill=get_color("bg3"))
        round_rect(draw, (ex + 6, ey_item + 6, ex + 20, ey_item + 20), 4, fill=hex_to_rgb(color))
        draw.text((ex + 26, ey_item + 5), name, font=font_name, fill=get_color("text"))
        bw = draw.textbbox((0, 0), bang, font=font_bang)[2]
        draw.text((ex + col_w - bw - 8, ey_item + 6), bang, font=font_bang, fill=get_color("purple"))
    
    ey = ey + ((len(search_engines) + 1) // 2) * 34 + 16
    
    # Footer
    font_hint = load_font(10, mono=True)
    draw.text((px + 20, py + ph - 28), "Alt+Shift+B", font=font_hint, fill=get_color("text3"))
    draw.text((px + 110, py + ph - 28), "opens slingshot", font=font_hint, fill=get_color("text3"))
    
    return img


# ── Screenshot 3: Settings Page ──
def make_screenshot_3():
    """Settings page screenshot showing customization."""
    img = gradient_bg(W, H, DARK["bg"], "#0c0b18")
    draw = ImageDraw.Draw(img)
    
    # Background glow
    glow = radial_glow_overlay(W, H, (W - 200, H//2), 500, hex_to_rgb(DARK["grad_teal"]), 0.05)
    img = Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')
    draw = ImageDraw.Draw(img)
    
    # Headline
    font_headline = load_font(40, bold=True)
    font_sub = load_font(18)
    headline = "Customize your shortcuts"
    subtitle = "Toggle engines, edit bangs, and add your own."
    
    hbbox = draw.textbbox((0, 0), headline, font=font_headline)
    sbbox = draw.textbbox((0, 0), subtitle, font=font_sub)
    hx = (W - (hbbox[2]-hbbox[0])) // 2
    sx = (W - (sbbox[2]-sbbox[0])) // 2
    draw.text((hx, 50), headline, font=font_headline, fill=get_color("text"))
    draw.text((sx, 108), subtitle, font=font_sub, fill=get_color("text2"))
    
    # Browser window showing settings
    bw, bh = 900, 560
    bx = (W - bw) // 2
    by = 160
    
    bar_y, bar_h, bar_m = draw_browser_chrome(draw, img, bx, by, bw, bh, "Slingshot Settings")
    
    # Sidebar
    sb_w = 200
    round_rect(draw, (bx, by + 36, bx + sb_w, by + bh), 0, fill=get_color("bg3"))
    # Sidebar border
    draw.line([(bx + sb_w, by + 36), (bx + sb_w, by + bh)], fill=get_color("border"), width=1)
    
    # Logo in sidebar
    draw_logo(draw, bx + 16, by + 52, size=18)
    
    # Nav items
    nav_items = [
        ("Search Engines", True, "8"),
        ("AI Prompter", False, "7"),
        ("Features", False, None),
        ("Shortcuts", False, None),
    ]
    font_nav = load_font(12)
    font_nav_label = load_font(10)
    ny = by + 100
    
    # Section label
    draw.text((bx + 16, ny), "CONFIGURE", font=font_nav_label, fill=get_color("text3"))
    ny += 24
    
    for name, active, badge in nav_items:
        if active:
            round_rect(draw, (bx + 10, ny - 2, bx + sb_w - 10, ny + 26), 8, 
                       fill=(108, 99, 255, 25), outline=(108, 99, 255, 38), width=1)
            draw.text((bx + 22, ny), name, font=font_nav, fill=get_color("purple"))
        else:
            draw.text((bx + 22, ny), name, font=font_nav, fill=get_color("text2"))
        if badge:
            bw_badge = draw.textbbox((0, 0), badge, font=font_nav_label)[2]
            round_rect(draw, (bx + sb_w - 36, ny + 2, bx + sb_w - 14, ny + 18), 10, 
                       fill=(108, 99, 255, 25), outline=(108, 99, 255, 38), width=1)
            draw.text((bx + sb_w - 30, ny + 2), badge, font=font_nav_label, fill=get_color("purple"))
        ny += 32
    
    # Main content area
    mx = bx + sb_w + 24
    my = by + 48
    mw = bw - sb_w - 48
    
    # Page title
    font_title = load_font(22, bold=True)
    font_pg_sub = load_font(13)
    draw.text((mx, my), "Search Engines", font=font_title, fill=get_color("text"))
    draw.text((mx, my + 32), "Toggle engines on or off. Use ", font=font_pg_sub, fill=get_color("text2"))
    code_w = draw.textbbox((0, 0), "!all", font=font_pg_sub)[2]
    draw.text((mx + 200, my + 32), "!all", font=font_pg_sub, fill=get_color("text"))
    draw.text((mx + 200 + code_w, my + 32), " to fire all active engines by category.", font=font_pg_sub, fill=get_color("text2"))
    
    # Category tabs
    ty = my + 68
    tabs = ["All", "General", "Dev", "Design", "Research"]
    tx = mx
    font_tab = load_font(10, bold=True)
    for i, tab in enumerate(tabs):
        tw = draw.textbbox((0, 0), tab, font=font_tab)[2]
        if i == 0:
            round_rect(draw, (tx, ty, tx + tw + 20, ty + 24), 7, fill=get_color("bg2"), 
                       outline=get_color("border2"), width=1)
            draw.text((tx + 10, ty + 4), tab, font=font_tab, fill=get_color("purple"))
        else:
            draw.text((tx + 10, ty + 4), tab, font=font_tab, fill=get_color("text3"))
        tx += tw + 28
    
    # Card: Active engines
    cy = ty + 40
    card_h = 280
    round_rect(draw, (mx, cy, mx + mw, cy + card_h), 12, fill=get_color("bg2"), 
               outline=get_color("border"), width=1)
    
    # Card header
    round_rect(draw, (mx, cy, mx + mw, cy + 44), 12, fill=get_color("bg2"))
    draw.rectangle((mx + 1, cy + 30, mx + mw - 1, cy + 44), fill=get_color("bg2"))
    font_card_title = load_font(12, bold=True)
    draw.text((mx + 16, cy + 14), "Active engines", font=font_card_title, fill=get_color("text"))
    
    # Engine rows
    engines = [
        ("#4285f4", "Google", "google.com", "!gg", True),
        ("#ff0000", "YouTube", "youtube.com", "!yt", True),
        ("#ff4500", "Reddit", "reddit.com", "!r", True),
        ("#333", "Wikipedia", "en.wikipedia.org", "!w", True),
        ("#fb522c", "Brave Search", "search.brave.com", "!bs", True),
        ("#0acf83", "Figma Community", "figma.com", "!fg", True),
    ]
    
    ry = cy + 50
    font_row_name = load_font(12, bold=True)
    font_row_url = load_font(10, mono=True)
    font_bang = load_font(11, mono=True)
    
    for color, name, url, bang, active in engines:
        # Icon
        round_rect(draw, (mx + 16, ry + 6, mx + 40, ry + 30), 6, fill=hex_to_rgb(color))
        # Name
        draw.text((mx + 48, ry + 6), name, font=font_row_name, fill=get_color("text"))
        # URL
        draw.text((mx + 48, ry + 22), url, font=font_row_url, fill=get_color("text3"))
        # Bang
        bw_text = draw.textbbox((0, 0), bang, font=font_bang)[2]
        round_rect(draw, (mx + mw - 140, ry + 8, mx + mw - 140 + bw_text + 16, ry + 28), 12, 
                   fill=(108, 99, 255, 20), outline=(108, 99, 255, 38), width=1)
        draw.text((mx + mw - 132, ry + 9), bang, font=font_bang, fill=get_color("purple"))
        # Toggle
        draw_toggle(draw, mx + mw - 50, ry + 8, on=active)
        
        ry += 40
        if ry < cy + card_h - 10:
            draw.line([(mx + 16, ry - 4), (mx + mw - 16, ry - 4)], fill=get_color("border"), width=1)
    
    # Bottom hint
    hint_y = cy + card_h + 16
    font_hint = load_font(11)
    draw.text((mx, hint_y), "Click any inactive engine below to activate it instantly.", 
              font=font_hint, fill=get_color("text3"))
    
    return img


# ── Main ──
def main():
    print("Generating Slingshot Chrome Web Store screenshots...")
    
    img1 = make_screenshot_1()
    path1 = os.path.join(OUT_DIR, "slingshot_screenshot_1_hero.png")
    img1.save(path1, "PNG", dpi=(144, 144))
    print(f"  Saved: {path1}")
    
    img2 = make_screenshot_2()
    path2 = os.path.join(OUT_DIR, "slingshot_screenshot_2_popup.png")
    img2.save(path2, "PNG", dpi=(144, 144))
    print(f"  Saved: {path2}")
    
    img3 = make_screenshot_3()
    path3 = os.path.join(OUT_DIR, "slingshot_screenshot_3_settings.png")
    img3.save(path3, "PNG", dpi=(144, 144))
    print(f"  Saved: {path3}")
    
    print("Done!")


if __name__ == "__main__":
    main()
