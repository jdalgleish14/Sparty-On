"""Groundwork for verified late-season routes; these helpers do not prove a clinch."""
from decimal import Decimal, InvalidOperation


def path_window(through_week, regular_weeks=14):
    if not isinstance(through_week, int) or not 0 <= through_week <= regular_weeks:
        raise ValueError('Invalid completed week')
    remaining = regular_weeks-through_week
    return dict(remaining_weeks=remaining, ready_for_detailed_search=1 <= remaining <= 3,
                phase='final' if remaining == 0 else 'late' if remaining <= 3 else 'early')


def _points(value):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0 or result != result.quantize(Decimal('.01')):
            raise ValueError('Scores must be nonnegative, finite, and stated in cents')
    except InvalidOperation as error:
        raise ValueError('Scores must be nonnegative, finite, and stated in cents') from error
    return result


def pf_requirement(target_pf, rival_pf, target_remaining_score=None):
    """Pairwise PF edge only. Qualification and record ties must be checked elsewhere.

    A rival cannot finish above the selected team on PF if its future scoring is
    strictly below selected-team future scoring plus their current PF difference.
    Equality leaves PF tied; no unspecified secondary tiebreaker is invented.
    """
    gap = _points(target_pf)-_points(rival_pf)
    result = dict(type='pairwise_pf_edge', operator='<', gap=str(gap),
                  formula='rival remaining PF < your remaining PF + current PF lead',
                  equality='PF tied; another rule or commissioner decision is required',
                  proves_playoff_spot=False)
    if target_remaining_score is not None:
        threshold = _points(target_remaining_score)+gap
        result.update(rival_must_score_less_than=str(threshold),
                      possible_with_nonnegative_scores=threshold > 0)
    return result
