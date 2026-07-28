import { IntelBoard } from './IntelBoard'
import { fetchDifferentials } from '../../services/intelligenceApi'

export function Differentials({ league = 'PL' }) {
  return (
    <IntelBoard
      eyebrow="Differential Finder"
      title="Hidden gems"
      subtitle="Low-owned players our model rates highly — the picks that win mini-leagues when they return."
      boardLabel="differential list"
      fetcher={fetchDifferentials}
      league={league}
    />
  )
}
