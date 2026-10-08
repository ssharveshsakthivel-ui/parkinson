import os
os.environ["HF_HOME"] = "/Users/sharvesh/Downloads/parkinson/.cache"
import torch
from transformers import AutoModelForImageClassification

class HuggingFaceResNet(torch.nn.Module):
    def __init__(self, num_classes=2):
        super().__init__()
        # Load pre-trained ResNet-18
        self.encoder = AutoModelForImageClassification.from_pretrained(
            "microsoft/resnet-18",
            num_labels=num_classes,
            ignore_mismatched_sizes=True
        )
        
    def forward(self, x):
        return self.encoder(x).logits

model = HuggingFaceResNet()
print(model(torch.randn(2, 3, 224, 224)).shape)
