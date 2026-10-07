// Cuantas empresas se consultan a la vez; evita saturar la conexion a la base con muchas empresas
const BATCH_SIZE = 5;

// Aplica la consulta a cada empresa en tandas, conservando el orden original
export async function mapInBatches<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    results.push(...(await Promise.all(batch.map(work))));
  }
  return results;
}
