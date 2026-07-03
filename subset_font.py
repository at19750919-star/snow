"""
子集化「獅尾四季春加糖 TC」：
只保留 ASCII + 標點 + 教育部常用字（約 4800）+ 次常用字（約 6300）→ woff2
"""
import os
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

SRC = r"C:\Users\at197\AppData\Local\Microsoft\Windows\Fonts\SweiSpringSugarCJKtc-Regular.ttf"
DST = os.path.join(os.path.dirname(__file__), "fonts", "SweiSpringSugarCJKtc.woff2")

# 教育部常用字4808字 + 次常用字6341字的 Unicode 範圍
# 大部分落在 U+4E00~U+9FFF，但我們用更精準的方式：
# 只取 U+4E00~U+9FFF 裡字型實際有的字（由 fontTools 自動處理）
# 加上 Big5 涵蓋的 U+4E00~U+9FA5 約 13000 字

unicodes = set(range(0x20, 0x7F))        # ASCII
unicodes |= set(range(0x3000, 0x303F))   # CJK 標點
unicodes |= set(range(0xFF01, 0xFF5F))   # 全形英數標點
unicodes |= set(range(0xFE30, 0xFE44))   # CJK 相容形式（直排標點）
unicodes |= set(range(0x4E00, 0x9FA6))   # CJK 統一漢字（Big5 範圍）
unicodes |= set(range(0x3100, 0x3130))   # 注音符號
# 常用符號
for c in "…—─·×÷±≠≒≦≧∞°℃€¥£©®™§¶†‡※★☆●○◎△▲▽▼□■◇◆♀♂→←↑↓↗↘↙↖「」『』【】〈〉《》〔〕":
    unicodes.add(ord(c))

unicodes = sorted(unicodes)
print(f"Codepoints: {len(unicodes)}")

font = TTFont(SRC)
options = Options()
options.flavor = "woff2"
options.desubroutinize = True
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.notdef_outline = True

subsetter = Subsetter(options=options)
subsetter.populate(unicodes=unicodes)
subsetter.subset(font)

os.makedirs(os.path.dirname(DST), exist_ok=True)
font.save(DST)

print(f"Saved: {DST}")
print(f"Size: {os.path.getsize(DST) / (1024*1024):.1f} MB")
