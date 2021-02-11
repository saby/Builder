@Library('pipeline') _

def version = '21.1100'

node ('controls') {
    checkout_pipeline("21.1100/bugfix/bls/status_cli")
    run_branch = load '/home/sbis/jenkins_pipeline/platforma/branch/run_branch'
    run_branch.execute('builder', version)
}