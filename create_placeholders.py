from PIL import Image, ImageDraw, ImageFont
import os

def create_placeholder(width, height, text, filename):
    # Create a new image with a light gray background
    image = Image.new('RGB', (width, height), color='#f0f0f0')
    draw = ImageDraw.Draw(image)
    
    # Add a border
    draw.rectangle([(0, 0), (width-1, height-1)], outline='#cccccc')
    
    # Add text
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except:
        font = ImageFont.load_default()
    
    text_width = draw.textlength(text, font=font)
    text_height = 24
    position = ((width - text_width) // 2, (height - text_height) // 2)
    
    draw.text(position, text, fill='#666666', font=font)
    
    # Save the image
    image.save(filename)

# Create assets directory if it doesn't exist
os.makedirs('assets/gallery', exist_ok=True)
os.makedirs('assets/accessories', exist_ok=True)

# Create placeholder images
create_placeholder(800, 400, 'Henricssons Logo', 'assets/henricssons_logo4.png')
create_placeholder(1920, 1080, 'Hero Background', 'assets/hero-bg.jpg')
create_placeholder(800, 600, 'About Image', 'assets/about-image.jpg')

# Gallery images
create_placeholder(800, 600, 'Motorbåt 1', 'assets/gallery/motorbat1.jpg')
create_placeholder(800, 600, 'Segelbåt 1', 'assets/gallery/segelbat1.jpg')
create_placeholder(800, 600, 'Special 1', 'assets/gallery/special1.jpg')

# Accessory images
create_placeholder(400, 300, 'Dragkedjor', 'assets/accessories/zipper.jpg')
create_placeholder(400, 300, 'Tyger', 'assets/accessories/fabric.jpg')
create_placeholder(400, 300, 'Beslag', 'assets/accessories/hardware.jpg')
create_placeholder(400, 300, 'Fönster', 'assets/accessories/windows.jpg')

# Partner logos
create_placeholder(200, 100, 'Jens Sagen', 'assets/jens-sagen.png')
create_placeholder(200, 100, 'Helly Hansen', 'assets/helly-hansen.png')
create_placeholder(200, 100, 'VA Varuste', 'assets/va-varuste.png')
create_placeholder(200, 100, 'Schultz Kalecher', 'assets/schultz-kalecher.png')
create_placeholder(200, 100, 'MP Venekuomu', 'assets/mp-venekuomu.png')

print("Placeholder images created successfully!") 