import base64
import hashlib
import json
from pathlib import Path

photo = "data:image/png;base64," + base64.b64encode(
    Path("app/src/main/assets/art/home.png").read_bytes()
).decode("ascii")
key = hashlib.sha256(photo.encode()).hexdigest()
root = Path("upgrade-fixture")
(root / "photos").mkdir(parents=True, exist_ok=True)
(root / "photos" / (key + ".txt")).write_text(photo)
client = {
    "id": "legacy-client", "name": "Клієнт 1.1.5", "address": "Вулиця Тестова", "phone": "+380000000000",
    "type": "Приватний будинок", "note": "Збережені дані"
}
finding = {
    "id": "legacy-finding", "cid": client["id"], "type": "Тепла підлога", "room": "Стара кімната",
    "air": "20", "surface": "16", "humidity": "42", "defect": "Тепловтрати",
    "recommendation": "Додати ізоляцію", "date": "18.11.2026", "photo": f"photo:{key}"
}
data = {
    "clients": [client],
    "orders": [{
        "id": "legacy-order", "cid": client["id"], "service": "Тепла підлога",
        "qty": 1, "price": 550, "discount": 0, "total": 550, "paid": 400,
        "status": "Виконане", "date": "18.11.2026"
    }],
    "findings": [finding],
    "reports": [{
        "id": "legacy-report", "cid": client["id"], "client": client,
        "findings": [finding["id"]], "date": "18.11.2026", "type": finding["type"],
        "conclusion": "Висновок 1.1.5", "expert": "Експерт 1.1.5"
    }],
    "prices": [["Тепла підлога", 550]]
}
(root / "database.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
