import kagglehub

# Download latest version
path = kagglehub.dataset_download("viacheslavasadchiy/radiographs-welding-defect-detection")

print("Path to dataset files:", path)
