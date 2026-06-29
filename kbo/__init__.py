"""KBO (Korean Baseball Organization) prediction platform.

A baseball sibling of the soccer modules (`src/` fee model, `pl/` league sim):
Stage 1 values each club's offense and run-prevention from in-house sabermetrics,
Stage 2 Monte-Carlos the 144-game KBO season + the postseason stepladder, and the
`web/` layer renders the championship odds. All data comes from legitimate public
sources (KBO official /Record pages + the open choosunsick/KBO_data game log); the
advanced metrics (wOBA/wRC+/FIP/WAR) are computed here, not copied from statiz.
"""
