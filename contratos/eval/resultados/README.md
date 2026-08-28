# Resultados de eval aprovados

Esta pasta permanece sem **resultado aprovado de promoção** enquanto a personalidade candidata não
concluir o gate confiável. Rodadas locais e alegações não autenticadas podem existir durante a
avaliação, mas ficam no estado privado do Omni e não entram aqui como se fossem aprovação.

Uma promoção futura adicionará somente o resumo definido por
`../resultado-personalidade.schema.json`. Respostas completas e conversas permanecem fora do Git;
seus conjuntos são identificados por SHA-256 no resumo. O manifesto aponta para o resultado e fixa o
hash exato do arquivo aprovado.

Não criar resultado sintético para destravar o status. A rodada precisa usar as mesmas entradas da
suíte em sessões isoladas de baseline e candidata, seguida de revisão humana real, recibos
criptográficos verificados internamente e identidade externa autenticada do proprietário. O runtime
atual ainda não oferece esses dois últimos elementos e, por isso, não produz resultado promovível.
