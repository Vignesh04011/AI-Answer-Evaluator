from PIL import Image, ImageDraw, ImageFont
import random
import textwrap
import os

# Setup
output_dir = "output_images"
os.makedirs(output_dir, exist_ok=True)
font = ImageFont.load_default()

image_width, image_height = 1200, 1600
line_height = 20
left_margin = 50
content_indent = 150

question_formats = ['Q.{}', 'A.', 'B.', '[C]', '(D)', 'Q{}.', '[{}]', '({})', '{}.']
dummy_words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split()

def generate_question_text(q_num):
    q_format = random.choice(question_formats)
    q_label = q_format.format(q_num)
    words = random.choices(dummy_words, k=random.randint(120, 150))
    full_text = ' '.join(words)
    lines = textwrap.wrap(full_text, width=115)
    return q_label, lines

def create_image(index):
    img = Image.new("RGB", (image_width, image_height), "white")
    draw = ImageDraw.Draw(img)
    y = 50
    q_num = 1

    while y < image_height - 100:
        q_label, lines = generate_question_text(q_num)

        # First line: question number + content
        draw.text((left_margin, y), q_label, fill="black", font=font)
        draw.text((content_indent, y), lines[0], fill="black", font=font)
        y += line_height

        # Remaining lines
        for line in lines[1:]:
            draw.text((content_indent, y), line, fill="black", font=font)
            y += line_height

        y += 30
        q_num += 1

    img.save(f"{output_dir}/question_image_{index+1}.png")

# Generate 300 images
for i in range(300):
    create_image(i)

print("✅ Done! 300 images generated in 'output_images/' folder.")
