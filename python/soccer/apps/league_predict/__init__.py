"""Big-5 league match prediction, VALUE-driven (몸값 → 시너지 → 시뮬).

Every input comes from the Naver feeds the nightly cron lands in Supabase
(soccer_games, soccer_player_stats); the 2022 Transfermarkt values only seed the
player-value chain once. See README.md for the pipeline and the backtest.
"""
