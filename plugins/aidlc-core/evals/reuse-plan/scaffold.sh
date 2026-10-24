#!/usr/bin/env bash
# $0 is this script's absolute path, in Windows or POSIX form; the shared fixtures sit beside the cases.
bs='\'
self="${0//"$bs"//}"
FIXTURES="${self%/*/*}/fixtures"
. "$FIXTURES/setup.sh"
