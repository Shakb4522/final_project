"""
Clean WeldSight dataset:
1. Remove all annotations for class 5 (undercut) and class 6 (inclusion)
2. Remap remaining classes: 7->5, 8->6
3. Delete images+labels that become empty after removal
4. Update data.yaml for Ultralytics with correct paths and 7 classes
"""
import os
import glob

DATASET_DIR = r"d:\final_project\WeldSight_RT_Master"
REMOVE_CLASSES = {5, 6}  # undercut, inclusion
REMAP = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 7: 5, 8: 6}

stats = {"removed_annotations": 0, "remapped_annotations": 0, "emptied_files": 0}

for split in ["train", "val"]:
    labels_dir = os.path.join(DATASET_DIR, split, "labels")
    images_dir = os.path.join(DATASET_DIR, split, "images")

    label_files = glob.glob(os.path.join(labels_dir, "*.txt"))
    print(f"\n--- Processing {split}: {len(label_files)} label files ---")

    for lf in label_files:
        with open(lf, "r") as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue
            cls_id = int(parts[0])
            if cls_id in REMOVE_CLASSES:
                stats["removed_annotations"] += 1
                continue
            # Remap class ID
            new_cls = REMAP[cls_id]
            if new_cls != cls_id:
                stats["remapped_annotations"] += 1
            parts[0] = str(new_cls)
            new_lines.append(" ".join(parts) + "\n")

        if len(new_lines) == 0:
            # Remove empty label file and its corresponding image
            os.remove(lf)
            basename = os.path.splitext(os.path.basename(lf))[0]
            for ext in [".jpg", ".jpeg", ".png", ".bmp"]:
                img_path = os.path.join(images_dir, basename + ext)
                if os.path.exists(img_path):
                    os.remove(img_path)
                    break
            stats["emptied_files"] += 1
        else:
            with open(lf, "w") as f:
                f.writelines(new_lines)

    # Also remove labels.cache so Ultralytics rebuilds it
    cache_file = os.path.join(DATASET_DIR, split, "labels.cache")
    if os.path.exists(cache_file):
        os.remove(cache_file)
        print(f"  Removed {cache_file}")

# Update data.yaml
yaml_content = f"""path: {DATASET_DIR}
train: train/images
val: val/images

nc: 7
names: ['crack', 'porosity', 'lack_of_fusion', 'lack_of_penetration', 'slag', 'spatter', 'defect']
"""

yaml_path = os.path.join(DATASET_DIR, "data.yaml")
with open(yaml_path, "w") as f:
    f.write(yaml_content)

print(f"\n=== DONE ===")
print(f"Removed annotations:  {stats['removed_annotations']}")
print(f"Remapped annotations: {stats['remapped_annotations']}")
print(f"Emptied files deleted: {stats['emptied_files']}")
print(f"data.yaml updated at: {yaml_path}")

# Quick verification
for split in ["train", "val"]:
    imgs = len(glob.glob(os.path.join(DATASET_DIR, split, "images", "*")))
    lbls = len(glob.glob(os.path.join(DATASET_DIR, split, "labels", "*.txt")))
    print(f"  {split}: {imgs} images, {lbls} labels {'✓' if imgs == lbls else '✗ MISMATCH!'}")
