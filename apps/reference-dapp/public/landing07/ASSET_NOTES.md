# Landing 07 — assets da hero

Referência visual aprovada: `C:/Users/caiom/Downloads/modelo v7/Hero da FloFi com fita azul.png`. Ela não é servida pela página. Os três PNGs abaixo foram gerados a partir dessa referência como camadas transparentes para a hero. O logo do cabeçalho continua vindo de `/public/brand`.

| Asset | Uso |
| --- | --- |
| `ribbon-reference-v2.png` | Fita azul 3D entre duas camadas tipográficas: o F fica atrás da fita e LOFI fica à frente. |
| `mascot-reference-v2.png` | Personagem azul e branco à esquerda do título. |
| `bubble-reference-v2.png` | Balão 3D à direita do título. |

Geração: ferramenta interna `image_gen`, modo de edição com a imagem aprovada como referência e fundo transparente. Os prompts finais selecionados foram:

- **Fita:** “Reconstruct ONLY the giant continuous cobalt-blue sculptural ribbon from that reference, isolated with true alpha transparency and no background, no logo, no letters, no mascot, no buttons, no speech bubble. Keep its exact overall spatial path: upper arc enters from top center-left and sweeps toward top-right; large left oval loop wraps around the lower left of the central word area; a narrow middle diagonal ribbon strand passes behind the letter area from left lower to right center; a large right arc/loop curls from middle-right downward and out the bottom-right. Premium tactile microtexture, strong but controlled blue reflections, dimensional rounded cross-section, soft edge lighting, no neon, no generic wave.”
- **Mascote:** “Faithfully isolate the FloFi mascot at left of FLOFI: white smiling face between two glossy blue wave/leaf crests, same proportions, colors, lighting and orientation. No text, no added parts, no background. True transparent alpha, centered clean cutout.”
- **Balão:** “Faithfully isolate and reconstruct ONLY the small floating glossy white chat bubble near the right side of FLOFI: rounded rectangular speech balloon, softly translucent pearlescent white and blue edges, small pointed tail lower left, exactly three vivid blue spherical dots in its center. Same slight perspective, polished reflections and soft volume as reference. No text, no FloFi letters or ribbon or mascot, true transparent alpha, centered clean cutout.”

**Limite:** são renderizações 2D transparentes. O CSS move as camadas com sutileza e dissolve a ponta da fita na transição para a próxima seção; ele não deforma a geometria nem recalcula reflexos como uma cena 3D real. Para uma fita literalmente contínua e uma animação 3D exata do mascote, seriam necessários os arquivos de cena/modelo originais ou uma renderização de vídeo com alpha aprovada pela equipe de marca.

## Seção 04 — Possibilidades

Referência aprovada: `C:/Users/caiom/Downloads/Uma ideia, muitas possibilidades.png`. O screenshot completo não é usado na página. As três ilustrações abaixo foram geradas como camadas transparentes separadas, seguindo os objetos e a iluminação da referência. Os títulos, cards, legendas e botões são HTML/CSS responsivos. Os exemplos são ilustrativos e cada botão apenas abre `/app`.

| Asset | Uso |
| --- | --- |
| `swap-sculpture.png` | Dois discos brancos em troca, ligados por setas azuis. |
| `transfer-sculpture.png` | Duas plataformas de rede conectadas por um arco. |
| `strategy-sculpture.png` | Três peças analíticas empilhadas com cursor. |

Geração: `image_gen`, modo de edição com a referência aprovada, fundo transparente. Prompts selecionados: “Recreate only the swap illustration visible in the LEFT cobalt-blue card: two large sculptural glossy white-blue coin or token discs in dynamic perspective ... linked by two dark royal-blue curved exchange arrows”; “Recreate only the transfer illustration visible in the CENTER white card: two separated small floating pale blue square network platforms ... a graceful thin curved blue transfer arc”; “Recreate only the strategy illustration visible in the RIGHT pale periwinkle card: three floating square white and pale blue analytics tiles stacked diagonally ... a single dark navy 3D cursor arrow”. Nenhum dos três assets representa uma operação, cotação ou estratégia real.
