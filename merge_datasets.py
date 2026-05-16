import os
import shutil
from tqdm import tqdm

kaggle_dir = r"C:\Users\boudo\.cache\kagglehub\datasets\viacheslavasadchiy\radiographs-welding-defect-detection\versions\1\data_kaggle"
master_dir = r"d:\final_project\WeldSight_RT_Master"

# Mapping Kaggle class ID to Master class ID
# Master classes:
# 0:crack, 1:porosity, 2:lack_of_fusion, 3:lack_of_penetration, 4:slag, 
# 5:undercut, 6:inclusion, 7:spatter, 8:defect, 9:burn_through, 10:overlap, 11:sagging
class_map = {
    0: 1,   # Пора (Porosity)
    1: 6,   # Включение (Inclusion)
    2: 5,   # Подрез (Undercut)
    3: 9,   # Прожог (Burn-through)
    4: 0,   # Трещина (Crack)
    5: 10,  # Наплыв (Overlap)
    # 6, 7, 8 are Etalons (Standards) -> discard
    9: 1,   # Пора-скрытая (Hidden porosity) -> porosity
    10: 11, # Утяжина (Sagging)
    11: 2,  # Несплавление (Lack of fusion)
    12: 3   # Непровар корня (Incomplete root penetration) -> lack_of_penetration
}

splits = ['train', 'val']

for split in splits:
    print(f"Processing {split} split...")
    kaggle_images_dir = os.path.join(kaggle_dir, split, "images")
    kaggle_labels_dir = os.path.join(kaggle_dir, split, "labels")
    
    master_images_dir = os.path.join(master_dir, split, "images")
    master_labels_dir = os.path.join(master_dir, split, "labels")
    
    os.makedirs(master_images_dir, exist_ok=True)
    os.makedirs(master_labels_dir, exist_ok=True)
    
    images = os.listdir(kaggle_images_dir)
    
    for img_name in tqdm(images, desc=f"Copying {split}"):
        base_name = os.path.splitext(img_name)[0]
        ext = os.path.splitext(img_name)[1]
        
        # New prefix to prevent overwriting existing dataset files
        new_base = f"kaggle_{base_name}"
        new_img_name = f"{new_base}{ext}"
        new_lbl_name = f"{new_base}.txt"
        
        lbl_name = f"{base_name}.txt"
        
        lbl_path = os.path.join(kaggle_labels_dir, lbl_name)
        new_lbl_path = os.path.join(master_labels_dir, new_lbl_name)
        
        # Process label file if it exists
        has_valid_labels = False
        if os.path.exists(lbl_path):
            with open(lbl_path, 'r') as f:
                lines = f.readlines()
            
            new_lines = []
            for line in lines:
                parts = line.strip().split()
                if not parts: continue
                cls_id = int(parts[0])
                if cls_id in class_map:
                    new_cls_id = class_map[cls_id]
                    new_line = f"{new_cls_id} {' '.join(parts[1:])}\n"
                    new_lines.append(new_line)
            
            if new_lines:
                has_valid_labels = True
                with open(new_lbl_path, 'w') as f:
                    f.writelines(new_lines)
        
        # Copy image only if it has valid defects (or if you want all images, remove this check. 
        # But usually in YOLO we want images with objects, or some background images. 
        # We will copy the image anyway if we want background, but let's only copy if it has valid labels to save space and time)
        if has_valid_labels:
            img_path = os.path.join(kaggle_images_dir, img_name)
            new_img_path = os.path.join(master_images_dir, new_img_name)
            shutil.copy2(img_path, new_img_path)

print("Updating data.yaml...")
yaml_path = os.path.join(master_dir, "data.yaml")
yaml_content = """train: d:/final_project/WeldSight_RT_Master/train/images
val: d:/final_project/WeldSight_RT_Master/val/images

nc: 12
names: ['crack', 'porosity', 'lack_of_fusion', 'lack_of_penetration', 'slag', 'undercut', 'inclusion', 'spatter', 'defect', 'burn_through', 'overlap', 'sagging']
"""
with open(yaml_path, 'w') as f:
    f.write(yaml_content)

print("Done merging datasets!")
