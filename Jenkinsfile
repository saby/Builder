@Library('pipeline') _

def version = '20.5000'

node ('controls') {
    checkout_pipeline("20.5000/bugfix/builder/timeout")
    run_branch = load '/home/sbis/jenkins_pipeline/platforma/branch/run_branch'
    run_branch.execute('builder', version)
}