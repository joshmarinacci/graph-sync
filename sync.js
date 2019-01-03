let current_id = 0;
function makeGUID() {
    current_id++
    return current_id
}

class ObjectSyncProtocol {
    constructor() {
        this.objs = {}
        this.listeners = []
    }
    createObject() {
        const obj = {
            _id:makeGUID()
        }
        this.objs[obj._id] = obj
        this.fire({type:'CREATE_OBJECT',id:obj._id})
        return this.objs[obj._id]
    }
    createProperty(obj, name, value) {
        obj[name] = value
        this.fire({type:'CREATE_PROPERTY',name:name,value:value})
    }
    setProperty(obj,name,value) {
        obj[name] = value
        this.fire({type:'SET_PROPERTY',name:name,value:value})
    }
    getId(obj) {
        return obj._id
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id
            graph[id] = {}
            Object.keys(obj).forEach(key => {
                if(key === '_id' && obj.id) {
                    graph[id]['id'] = obj.id
                } else {
                    graph[id][key] = obj[key]
                }
            })
        })
        return graph
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol