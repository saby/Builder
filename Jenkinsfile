@Library('pipeline') _

def version = '21.1000'

node ('controls') {
    checkout_pipeline("21.1000/bugfix/revision_engine_tests_rc_v2")
    run_branch = load '/home/sbis/jenkins_pipeline/platforma/branch/run_branch'
    run_branch.execute('builder', version)
}