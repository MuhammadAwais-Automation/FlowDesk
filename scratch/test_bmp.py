import struct

def create_bmp_24bit(width, height, draw_func):
    """
    Creates a 24-bit BMP image byte array using standard Python struct library.
    draw_func(x, y) returns (r, g, b) tuple (0-255).
    BMP pixels are stored bottom-to-top, left-to-right, BGR order.
    """
    row_bytes = width * 3
    padding = (4 - (row_bytes % 4)) % 4
    file_size = 54 + (row_bytes + padding) * height

    # File Header (14 bytes)
    header = struct.pack('<2sIHHI', b'BM', file_size, 0, 0, 54)
    # DIB Header (40 bytes - BITMAPINFOHEADER)
    dib = struct.pack('<IIIHHIIIIII', 40, width, height, 1, 24, 0, (row_bytes + padding) * height, 2835, 2835, 0, 0)

    pixel_data = bytearray()
    for y in range(height - 1, -1, -1): # bottom-up
        for x in range(width):
            r, g, b = draw_func(x, y)
            pixel_data.extend([b & 0xFF, g & 0xFF, r & 0xFF])
        pixel_data.extend([0] * padding)

    return header + dib + pixel_data

if __name__ == "__main__":
    def test_draw(x, y):
        return (229, 168, 83) if (x + y) % 20 < 2 else (18, 16, 14)

    bmp_bytes = create_bmp_24bit(164, 314, test_draw)
    with open("e:/FlowDesk/resources/test.bmp", "wb") as f:
        f.write(bmp_bytes)
    print("BMP created, size:", len(bmp_bytes))
