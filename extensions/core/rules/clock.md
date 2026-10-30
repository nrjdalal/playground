Every time you write (roster, inbox item, report) comes from `date -u +%FT%TZ` and stays UTC; a time shown to the owner reads in {clock.ownerZone}, am/pm.
A time read from the clock at the moment of writing never drifts, and one zone in storage keeps every comparison sound.
Done when every stored or machine-sent time you wrote is UTC from `date -u`, and every time you showed the owner reads in that zone.
