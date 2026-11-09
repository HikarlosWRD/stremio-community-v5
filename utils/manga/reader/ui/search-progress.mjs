export function searchProgressState(result, searching) {
    const total = result?.total;
    if (!Number.isInteger(total) || total < 0) {
        return {
            determinate: false,
            max: 1,
            value: 0,
            label: 'Preparando consulta às fontes…',
            counter: ''
        };
    }
    const current = Number.isFinite(result?.completed) ? Math.trunc(result.completed) : 0;
    const completed = Math.max(0, Math.min(total, current));
    const percent = total === 0 ? 100 : Math.round(completed / total * 100);
    return {
        determinate: true,
        max: Math.max(total, 1),
        value: total === 0 ? 1 : completed,
        label: searching ? 'Pesquisando nas fontes…' :
            completed === total ? 'Busca concluída' : 'Busca interrompida',
        counter: completed + ' de ' + total + ' fontes · ' + percent + '%'
    };
}
