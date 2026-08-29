# Resultados de eval aprovados

Esta pasta recebe somente resultados aprovados pelo executor local controlado. Rodadas incompletas,
falhas e alegações não verificadas ficam no estado privado do Omni.

Uma promoção adiciona somente o resumo definido por
`../resultado-personalidade.schema.json`. Respostas completas e conversas permanecem fora do Git;
seus conjuntos são identificados por SHA-256 no resumo. O manifesto aponta para o resultado e fixa o
hash exato do arquivo aprovado.

Não criar resultado sintético para destravar o status. A rodada usa o mesmo modelo e configurações em
capturas isoladas de baseline e candidata, seguida por decisão semântica do juiz controlado. Todos os
bindings e gates precisam passar; identidade externa inexistente não é mais usada como muro.
