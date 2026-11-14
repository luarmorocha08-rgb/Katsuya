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

## No ar
- Site: https://katsuya-ochre.vercel.app/
- QR Codes para imprimir (mesas 1–20 e pratos em AR): https://katsuya-ochre.vercel.app/qr.html
- Prato direto na câmera: `#ar-sushi`, `#ar-tonkatsu`, `#ar-lamen`

## Realismo dos pratos
- `assets/js/realismo.js` gera em código texturas de detalhe por ingrediente (grãos de arroz, panko, fibras do peixe, alga, gordura no caldo, esmalte da louça) e aplica pelo nome do material.
- Os modelos de AR (`assets/models/*.glb` e `*.usdz`) são gerados a partir de `assets/models/src/*.glb` com:
  `NODE_MODULES=<pasta com three@0.170.0> node tools/realismo-bake.js` (usa Playwright e Python/Pillow).
- A Mesa 3D usa sombras de contato (GTAO) para dar profundidade entre pratos, comida e mesa.
