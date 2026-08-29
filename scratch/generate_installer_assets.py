import struct

# Simple 5x7 bitmap font dictionary for uppercase letters, numbers, symbols
FONT_5X7 = {
    'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
    'D': [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
    'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
    'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    'G': [0x0E, 0x11, 0x10, 0x13, 0x11, 0x11, 0x0F],
    'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    'I': [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
    'J': [0x1F, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
    'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    'M': [0x11, 0x1B, 0x15, 0x11, 0x11, 0x11, 0x11],
    'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
    'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
    'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    'S': [0x0E, 0x11, 0x10, 0x0E, 0x01, 0x11, 0x0E],
    'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
    'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
    'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
    '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    '2': [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
    '3': [0x1F, 0x02, 0x04, 0x06, 0x01, 0x11, 0x0E],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
    '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
    '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
    '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    '-': [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
    '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
    ':': [0x00, 0x06, 0x06, 0x00, 0x06, 0x06, 0x00],
    '/': [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
    '[': [0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E],
    ']': [0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E],
    '>': [0x10, 0x08, 0x04, 0x02, 0x04, 0x08, 0x10],
    '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
    '#': [0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A],
    '=': [0x00, 0x1F, 0x00, 0x1F, 0x00, 0x00, 0x00],
    '+': [0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00],
    '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F],
    '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
}

class Canvas:
    def __init__(self, width, height, bg_color=(18, 16, 14)):
        self.width = width
        self.height = height
        self.pixels = [[bg_color for _ in range(width)] for _ in range(height)]

    def set_pixel(self, x, y, color):
        if 0 <= x < self.width and 0 <= y < self.height:
            self.pixels[y][x] = color

    def draw_rect(self, x, y, w, h, color, fill=None):
        if fill:
            for py in range(y, y + h):
                for px in range(x, x + w):
                    self.set_pixel(px, py, fill)
        for px in range(x, x + w):
            self.set_pixel(px, y, color)
            self.set_pixel(px, y + h - 1, color)
        for py in range(y, y + h):
            self.set_pixel(x, py, color)
            self.set_pixel(x + w - 1, py, color)

    def draw_line(self, x0, y0, x1, y1, color):
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            self.set_pixel(x0, y0, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def draw_text(self, text, x, y, color, scale=1):
        cx = x
        for ch in text.upper():
            glyph = FONT_5X7.get(ch, FONT_5X7[' '])
            for row in range(7):
                bits = glyph[row]
                for col in range(5):
                    if (bits >> (4 - col)) & 1:
                        for sy in range(scale):
                            for sx in range(scale):
                                self.set_pixel(cx + col * scale + sx, y + row * scale + sy, color)
            cx += (5 + 1) * scale

    def to_bmp_bytes(self):
        row_bytes = self.width * 3
        padding = (4 - (row_bytes % 4)) % 4
        file_size = 54 + (row_bytes + padding) * self.height

        header = struct.pack('<2sIHHI', b'BM', file_size, 0, 0, 54)
        dib = struct.pack('<IIIHHIIIIII', 40, self.width, self.height, 1, 24, 0, (row_bytes + padding) * self.height, 2835, 2835, 0, 0)

        pixel_data = bytearray()
        for y in range(self.height - 1, -1, -1):
            for x in range(self.width):
                r, g, b = self.pixels[y][x]
                pixel_data.extend([b & 0xFF, g & 0xFF, r & 0xFF])
            pixel_data.extend([0] * padding)

        return header + dib + pixel_data

# Color Palette from FlowDesk Theme
C_BG       = (18, 16, 14)       # #12100E
C_SURFACE  = (25, 22, 19)       # #191613
C_SURFACE2 = (33, 29, 25)       # #211D19
C_AMBER    = (229, 168, 83)     # #E5A853 (Warm Accent)
C_AMBER_M  = (100, 75, 38)      # Muted Amber
C_TEXT     = (237, 231, 214)    # #EDE7D6 (Parchment text)
C_TEXT_MUT = (140, 130, 115)    # Muted text
C_SUCCESS  = (16, 185, 129)     # Green status dot
C_BORDER   = (60, 50, 40)       # Retro border line

def generate_sidebar():
    canvas = Canvas(164, 314, C_BG)

    # 1. Subtle Retro Grid
    for y in range(0, 314, 12):
        for x in range(0, 164, 12):
            canvas.set_pixel(x, y, (28, 24, 20))

    # 2. Outer Retro Vintage Double Border
    canvas.draw_rect(3, 3, 158, 308, C_AMBER)
    canvas.draw_rect(5, 5, 154, 304, C_BORDER)
    # Corner ticks
    canvas.draw_rect(1, 1, 6, 6, C_AMBER, fill=C_AMBER)
    canvas.draw_rect(157, 1, 6, 6, C_AMBER, fill=C_AMBER)
    canvas.draw_rect(1, 307, 6, 6, C_AMBER, fill=C_AMBER)
    canvas.draw_rect(157, 307, 6, 6, C_AMBER, fill=C_AMBER)

    # 3. Header Title Badge
    canvas.draw_rect(10, 12, 144, 40, C_AMBER, fill=C_SURFACE)
    canvas.draw_text("FLOWDESK", 28, 20, C_AMBER, scale=2)
    canvas.draw_text("WORKSTATION", 38, 38, C_TEXT_MUT, scale=1)

    # Divider line
    canvas.draw_line(10, 58, 154, 58, C_AMBER_M)

    # 4. Minimal Agent Orchestrator Visual Diagram
    # Diagram Title
    canvas.draw_text("AGENT ORCHESTRATOR", 18, 66, C_AMBER, scale=1)

    # Node 1: [ PROMPT ]
    canvas.draw_rect(32, 80, 100, 20, C_BORDER, fill=C_SURFACE2)
    canvas.draw_text("[ PROMPT ]", 44, 86, C_TEXT, scale=1)

    # Down Arrow / Connection
    canvas.draw_line(82, 100, 82, 114, C_AMBER)
    canvas.set_pixel(81, 112, C_AMBER)
    canvas.set_pixel(83, 112, C_AMBER)

    # Node 2: Core Orchestrator (Glowing Amber Box)
    canvas.draw_rect(20, 114, 124, 28, C_AMBER, fill=C_SURFACE)
    canvas.draw_rect(22, 116, 120, 24, C_AMBER_M)
    canvas.draw_text("ORCHESTRATOR", 34, 124, C_AMBER, scale=1)

    # Branching Connector lines down to worker agents
    canvas.draw_line(82, 142, 82, 152, C_AMBER) # Center stem
    canvas.draw_line(34, 152, 130, 152, C_AMBER) # Horizontal bar
    canvas.draw_line(34, 152, 34, 160, C_AMBER) # Worker 1 vertical
    canvas.draw_line(82, 152, 82, 160, C_AMBER) # Worker 2 vertical
    canvas.draw_line(130, 152, 130, 160, C_AMBER) # Worker 3 vertical

    # Worker Nodes
    # Worker 1: CLAUDE
    canvas.draw_rect(12, 160, 44, 22, C_BORDER, fill=C_SURFACE2)
    canvas.draw_text("CLAUDE", 16, 167, C_TEXT, scale=1)

    # Worker 2: GEMINI
    canvas.draw_rect(60, 160, 44, 22, C_BORDER, fill=C_SURFACE2)
    canvas.draw_text("GEMINI", 64, 167, C_TEXT, scale=1)

    # Worker 3: AUTO
    canvas.draw_rect(108, 160, 44, 22, C_BORDER, fill=C_SURFACE2)
    canvas.draw_text("AUTO", 116, 167, C_TEXT, scale=1)

    # Status / Signal indicators below workers
    canvas.draw_text("SYNC OK", 14, 187, C_SUCCESS, scale=1)
    canvas.draw_text("ACTIVE", 64, 187, C_SUCCESS, scale=1)
    canvas.draw_text("READY", 112, 187, C_SUCCESS, scale=1)

    # Section Divider
    canvas.draw_line(10, 204, 154, 204, C_AMBER_M)

    # 5. Terminal Console / Log Window
    canvas.draw_rect(10, 212, 144, 88, C_AMBER_M, fill=C_SURFACE)
    canvas.draw_text("> SYS.INIT // V1.0", 16, 220, C_AMBER, scale=1)
    canvas.draw_text("> LOAD ENGINE..OK", 16, 234, C_TEXT_MUT, scale=1)
    canvas.draw_text("> PREP INSTALLER", 16, 248, C_TEXT_MUT, scale=1)
    canvas.draw_text("> DEPLOY TARGET...", 16, 262, C_TEXT, scale=1)
    
    # Blinking / glowing status bar
    canvas.draw_rect(16, 278, 132, 14, C_BORDER, fill=C_SURFACE2)
    canvas.draw_text("[ SYSTEM READY ]", 26, 282, C_SUCCESS, scale=1)

    return canvas.to_bmp_bytes()

def generate_header():
    canvas = Canvas(150, 57, C_BG)

    # Subtle Grid
    for y in range(0, 57, 10):
        for x in range(0, 150, 10):
            canvas.set_pixel(x, y, (28, 24, 20))

    # Outer Border & Bottom Accent Line
    canvas.draw_line(0, 56, 150, 56, C_AMBER)
    canvas.draw_line(0, 55, 150, 55, C_AMBER_M)

    # Logo Graphic on Right
    canvas.draw_rect(98, 8, 44, 40, C_AMBER, fill=C_SURFACE)
    canvas.draw_text("FD", 110, 18, C_AMBER, scale=2)

    # Text Info on Left
    canvas.draw_text("FLOWDESK", 10, 10, C_AMBER, scale=2)
    canvas.draw_text("AI WORKSTATION", 10, 30, C_TEXT_MUT, scale=1)
    canvas.draw_text("SETUP V1.0.0", 10, 42, C_TEXT, scale=1)

    return canvas.to_bmp_bytes()

if __name__ == "__main__":
    sidebar_bmp = generate_sidebar()
    header_bmp = generate_header()

    with open("e:/FlowDesk/resources/installerSidebar.bmp", "wb") as f:
        f.write(sidebar_bmp)
    print("installerSidebar.bmp created successfully! Size:", len(sidebar_bmp))

    with open("e:/FlowDesk/resources/installerHeader.bmp", "wb") as f:
        f.write(header_bmp)
    print("installerHeader.bmp created successfully! Size:", len(header_bmp))
