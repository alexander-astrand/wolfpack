#!/usr/bin/env bash
# Prints the current UTC time as HH:MMZ, for chain-log and ping stamps.
# Why: agents guessed the time and got it wrong; the clock does not.
date -u +%H:%MZ
