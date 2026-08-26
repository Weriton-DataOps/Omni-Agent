# Melhoria mensurável do Omni

As seções 27–30 se aplicam a um único agente: `omni`. Elas não criam Agent Registry nem selecionam
outros agentes.

Uma melhoria pode alterar instrução, definição de ferramenta, skill, procedimento, roteamento,
recuperação de contexto, recuperação de falha, eval ou política de modelo. A alteração precisa de uma
rodada anterior e outra posterior comparáveis.

Cada caso segue a estrutura obrigatória:

```text
input
context
expected behavior
allowed behavior
forbidden behavior
success criteria
evidence
score
```

O histórico guarda somente métricas e SHA-256 da evidência, nunca resposta, prompt ou conversa bruta.
Uma comparação reprova se houver regressão de segurança, queda de success rate ou queda de score. Custo
e latência são medidos e apresentados, mas não escondem perda de qualidade.

As avaliações de conversa serão alimentadas durante a validação extensa do Omni, antes da interface.
