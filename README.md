# Katsuya Sushi · Site + Cardápio 3D/AR

Site do restaurante, cardápio digital da mesa (QR Code) e a **Mesa 3D**: cada prato adicionado ao pedido é servido numa mesa em 3D e o pedido inteiro pode ser visto na mesa real em realidade aumentada.

## Estrutura
- `index.html` — site, cardápio da mesa e pedido (dados do restaurante e dos pratos no topo do `<script>`: `INFO`, `CATS`, `ITEMS`).
- `assets/js/mesa3d.js` — cena da mesa (three.js): mesa, jogos americanos, hashis e os pratos. Pratos com `model` usam o `.glb`; os demais usam o campo `p3d` (modelos desenhados em código: guioza, karaage, edamame, sunomono, sashimi, uramaki, temaki, yakisoba, salmao, misso, harumaki, mochi, lata, cha, saque). Um prato novo sem `p3d` aparece com uma tampa genérica.
- `assets/models/*.glb` — modelos 3D do combinado, tonkatsu e lámen.
- `assets/img/` — logo e fotos dos pratos.

## Rotas
- `/` — site.
- `/#cardapio` ou `/#mesa-7` — cardápio da mesa (o QR de cada mesa aponta para `#mesa-N`).

## Rodar localmente
Qualquer servidor estático, por exemplo `python3 -m http.server` e abra `http://localhost:8000`.
