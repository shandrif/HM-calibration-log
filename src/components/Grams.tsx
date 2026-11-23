import { gramsParts } from '../../shared/config';

/** Number and unit as separate runs so Arabic text never reshapes the digits. */
export function Grams({ tenths, lang }: { tenths: number; lang: 'en' | 'ar' }) {
  const { value, unit } = gramsParts(tenths, lang);
  return (
    <>
      <bdi dir="ltr">{value}</bdi> <small>{unit}</small>
    </>
  );
}
